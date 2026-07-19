import type { AbiEvent } from "viem";
import { DEPLOY_BLOCK, REGISTRY_ADDRESS, events, publicClient, registryAbi } from "./chain";
import { dbEnabled } from "./db";
import {
  neonFetchAllProjects,
  neonFetchProject,
  neonFetchRecentProjects,
  neonLookupProjectByRepo,
  neonRegistryStats,
} from "./neon";
import { bytes32ToOid, canonicalRepoPath, repoFullNameFromUrl, repoHashFromPath } from "./repo";
import { buildDaySeries, dayOf } from "./time";

// Re-export the pure repo helpers so existing importers keep working after the
// move to ./repo.
export { bytes32ToOid, canonicalRepoPath, repoHashFromPath };

export interface AttestationEntry {
  kind: "attestation";
  commitHash: string;
  treeHash: string;
  timestamp: number;
  txHash: string;
  blockNumber: bigint;
}

export interface ContractEntry {
  kind: "contract";
  address: string;
  label: string;
  timestamp: number;
  txHash: string;
  blockNumber: bigint;
}

export type TimelineEntry = AttestationEntry | ContractEntry;

export interface ProjectModel {
  projectId: number;
  owner: string;
  attestor: string;
  repoUrl: string;
  repoFullName: string | null;
  createdAt: number;
  sealedAt: number | null;
  sealTxHash: string | null;
  timeline: TimelineEntry[]; // chronological
  attestationCount: number;
}

interface RawLog {
  args: Record<string, unknown>;
  blockNumber: bigint | null;
  transactionHash: string | null;
}

/** Rate-limit errors must back off and retry, never bisect — splitting on a
 * 429 degenerates into thousands of single-block requests that make the
 * throttling strictly worse. */
function isRateLimit(err: unknown): boolean {
  const cause = (err as { cause?: { message?: string; code?: number; status?: number } }).cause;
  const text = `${err instanceof Error ? err.message : String(err)} ${cause?.message ?? ""}`;
  return (
    /rate limit|too many request/i.test(text) ||
    cause?.code === -32005 ||
    cause?.status === 429 ||
    (err as { status?: number }).status === 429
  );
}

export async function getLogsBisect(
  event: AbiEvent,
  projectId: bigint | undefined,
  from: bigint,
  to: bigint,
  depth = 0,
  attempt = 0
): Promise<RawLog[]> {
  try {
    const logs = await publicClient.getLogs({
      address: REGISTRY_ADDRESS,
      event,
      args: (projectId === undefined ? undefined : { projectId }) as never,
      fromBlock: from,
      toBlock: to,
    });
    return logs as unknown as RawLog[];
  } catch (err) {
    if (isRateLimit(err)) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return getLogsBisect(event, projectId, from, to, depth, attempt + 1);
    }
    if (depth > 24 || to <= from) throw err;
    // sequential halves: parallel bisection bursts straight into rate limits
    const mid = from + (to - from) / 2n;
    const a = await getLogsBisect(event, projectId, from, mid, depth + 1);
    const b = await getLogsBisect(event, projectId, mid + 1n, to, depth + 1);
    return [...a, ...b];
  }
}


export async function fetchProject(projectId: number): Promise<ProjectModel | null> {
  if (dbEnabled) {
    try {
      const fromDb = await neonFetchProject(projectId);
      if (fromDb) return fromDb;
    } catch {
      // fall through to RPC on any Neon error
    }
  }
  const id = BigInt(projectId);
  const [owner, attestor, , createdAt, sealedAt] = await publicClient.readContract({
    address: REGISTRY_ADDRESS,
    abi: registryAbi,
    functionName: "projects",
    args: [id],
  });
  if (owner === "0x0000000000000000000000000000000000000000") return null;

  const latest = await publicClient.getBlockNumber();
  const [regLogs, attLogs, linkLogs, sealLogs] = await Promise.all([
    getLogsBisect(events.registered, id, DEPLOY_BLOCK, latest),
    getLogsBisect(events.attested, id, DEPLOY_BLOCK, latest),
    getLogsBisect(events.linked, id, DEPLOY_BLOCK, latest),
    getLogsBisect(events.sealed, id, DEPLOY_BLOCK, latest),
  ]);

  const repoUrl = (regLogs[0]?.args.repoUrl as string | undefined) ?? "";

  const timeline: TimelineEntry[] = [
    ...attLogs.map(
      (l): AttestationEntry => ({
        kind: "attestation",
        commitHash: bytes32ToOid(l.args.commitHash as string),
        treeHash: bytes32ToOid(l.args.treeHash as string),
        timestamp: Number(l.args.timestamp as bigint),
        txHash: l.transactionHash ?? "",
        blockNumber: l.blockNumber ?? 0n,
      })
    ),
    ...linkLogs.map(
      (l): ContractEntry => ({
        kind: "contract",
        address: l.args.deployed as string,
        label: l.args.label as string,
        timestamp: Number(l.args.timestamp as bigint),
        txHash: l.transactionHash ?? "",
        blockNumber: l.blockNumber ?? 0n,
      })
    ),
  ].sort((a, b) => a.timestamp - b.timestamp || Number(a.blockNumber - b.blockNumber));

  return {
    projectId,
    owner,
    attestor,
    repoUrl,
    repoFullName: repoFullNameFromUrl(repoUrl),
    createdAt: Number(createdAt),
    sealedAt: sealedAt > 0n ? Number(sealedAt) : null,
    sealTxHash: (sealLogs[0]?.transactionHash as string | undefined) ?? null,
    timeline,
    attestationCount: attLogs.length,
  };
}

export interface RecentProject {
  projectId: number;
  repoUrl: string;
  owner: string;
  timestamp: number;
}

export interface RepoLookup {
  /** Input reduced to `github.com/owner/repo`, or null if it wasn't a repo URL. */
  path: string | null;
  /** The keccak256 key derived from `path`, or null when `path` is null. */
  repoHash: `0x${string}` | null;
  /** Registry project id, or 0 when no repo hashes to this key. */
  projectId: number;
}

/**
 * Resolve a user-supplied GitHub URL to its registry project id by hashing the
 * canonical path and reading `projectByRepo`. The lookup is trustless: the same
 * keccak256 anyone can recompute, read straight from the chain.
 */
export async function lookupProjectByRepo(url: string): Promise<RepoLookup> {
  const path = canonicalRepoPath(url);
  if (!path) return { path: null, repoHash: null, projectId: 0 };
  if (dbEnabled) {
    try {
      const fromDb = await neonLookupProjectByRepo(url);
      // A hit is authoritative; a miss may just be unsynced — fall through to RPC.
      if (fromDb.projectId > 0) return fromDb;
    } catch {
      // fall through to RPC on any Neon error
    }
  }
  const repoHash = repoHashFromPath(path);
  const id = await publicClient.readContract({
    address: REGISTRY_ADDRESS,
    abi: registryAbi,
    functionName: "projectByRepo",
    args: [repoHash],
  });
  return { path, repoHash, projectId: Number(id) };
}

export async function fetchRecentProjects(limit = 12): Promise<RecentProject[]> {
  if (dbEnabled) {
    try {
      return await neonFetchRecentProjects(limit);
    } catch {
      // fall through to RPC on any Neon error
    }
  }
  const latest = await publicClient.getBlockNumber();
  const logs = await getLogsBisect(events.registered, undefined, DEPLOY_BLOCK, latest);
  return logs
    .map((l) => ({
      projectId: Number(l.args.projectId as bigint),
      repoUrl: l.args.repoUrl as string,
      owner: l.args.owner as string,
      timestamp: Number(l.args.timestamp as bigint),
    }))
    .sort((a, b) => b.projectId - a.projectId)
    .slice(0, limit);
}

export interface ExplorerProject extends RecentProject {
  /** Seal timestamp, or null while the record is still open. */
  sealedAt: number | null;
}

/**
 * Every registered project with its live sealed state. Repo/owner come from the
 * ProjectRegistered logs; sealedAt is read per project from the `projects`
 * struct (a cheap call each) so the list reflects seals that happened after
 * registration. Ordered newest first.
 */
export async function fetchAllProjects(): Promise<ExplorerProject[]> {
  if (dbEnabled) {
    try {
      return await neonFetchAllProjects();
    } catch {
      // fall through to RPC on any Neon error
    }
  }
  const latest = await publicClient.getBlockNumber();
  const logs = await getLogsBisect(events.registered, undefined, DEPLOY_BLOCK, latest);
  const base = logs
    .map((l) => ({
      projectId: Number(l.args.projectId as bigint),
      repoUrl: l.args.repoUrl as string,
      owner: l.args.owner as string,
      timestamp: Number(l.args.timestamp as bigint),
    }))
    .sort((a, b) => b.projectId - a.projectId);

  return Promise.all(
    base.map(async (p) => {
      try {
        const [, , , , sealedAt] = await publicClient.readContract({
          address: REGISTRY_ADDRESS,
          abi: registryAbi,
          functionName: "projects",
          args: [BigInt(p.projectId)],
        });
        return { ...p, sealedAt: sealedAt > 0n ? Number(sealedAt) : null };
      } catch {
        return { ...p, sealedAt: null };
      }
    })
  );
}

// ── Registry-wide analytics ───────────────────────────────────────────────

export interface DayPoint {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  /** Attestations sealed that day. */
  count: number;
  /** Total projects registered up to and including that day. */
  cumulativeProjects: number;
}

export interface LeaderProject {
  projectId: number;
  repoUrl: string;
  attestations: number;
  sealed: boolean;
}

export interface ActivityItem {
  projectId: number;
  repoUrl: string;
  commitHash: string;
  timestamp: number;
  txHash: string;
}

export interface RegistryStats {
  projectCount: number;
  attestationCount: number;
  sealedCount: number;
  linkedContractCount: number;
  uniqueOwners: number;
  firstActivity: number | null;
  lastActivity: number | null;
  /** Continuous daily series from first to last activity (gaps filled, capped). */
  series: DayPoint[];
  /** Projects by attestation count, richest first. */
  leaderboard: LeaderProject[];
  /** Most recent attestations across every project, newest first. */
  recent: ActivityItem[];
}

const EMPTY_STATS: RegistryStats = {
  projectCount: 0,
  attestationCount: 0,
  sealedCount: 0,
  linkedContractCount: 0,
  uniqueOwners: 0,
  firstActivity: null,
  lastActivity: null,
  series: [],
  leaderboard: [],
  recent: [],
};

/**
 * One aggregate read of the whole registry: every ProjectRegistered, Attested,
 * Sealed, and ContractLinked event is fetched once, then reduced into headline
 * counts, a daily time-series, a leaderboard, and a recent-activity feed. All
 * derived from chain logs — no mock data. Prefers the Neon index when
 * configured; degrades to zeroed stats on error so the page renders.
 */
export async function fetchRegistryStats(): Promise<RegistryStats> {
  if (dbEnabled) {
    try {
      return await neonRegistryStats();
    } catch {
      // fall through to RPC on any Neon error
    }
  }
  try {
    const latest = await publicClient.getBlockNumber();
    const [regLogs, attLogs, sealLogs, linkLogs] = await Promise.all([
      getLogsBisect(events.registered, undefined, DEPLOY_BLOCK, latest),
      getLogsBisect(events.attested, undefined, DEPLOY_BLOCK, latest),
      getLogsBisect(events.sealed, undefined, DEPLOY_BLOCK, latest),
      getLogsBisect(events.linked, undefined, DEPLOY_BLOCK, latest),
    ]);

    const repoUrlById = new Map<number, string>();
    const owners = new Set<string>();
    const registeredDays: { day: string; projectId: number }[] = [];
    for (const l of regLogs) {
      const id = Number(l.args.projectId as bigint);
      repoUrlById.set(id, (l.args.repoUrl as string) ?? "");
      owners.add((l.args.owner as string).toLowerCase());
      registeredDays.push({ day: dayOf(Number(l.args.timestamp as bigint)), projectId: id });
    }

    const sealed = new Set<number>(sealLogs.map((l) => Number(l.args.projectId as bigint)));

    const attestations = attLogs.map((l) => ({
      projectId: Number(l.args.projectId as bigint),
      commitHash: bytes32ToOid(l.args.commitHash as string),
      timestamp: Number(l.args.timestamp as bigint),
      txHash: l.transactionHash ?? "",
    }));

    // Headline timestamps span every event kind.
    const allTimestamps = [
      ...attestations.map((a) => a.timestamp),
      ...registeredDays.map((r) => new Date(`${r.day}T00:00:00Z`).getTime() / 1000),
    ];
    const firstActivity = allTimestamps.length ? Math.min(...allTimestamps) : null;
    const lastActivity = attestations.length
      ? Math.max(...attestations.map((a) => a.timestamp))
      : firstActivity;

    // Per-day attestation counts and cumulative registrations.
    const attByDay = new Map<string, number>();
    for (const a of attestations) attByDay.set(dayOf(a.timestamp), (attByDay.get(dayOf(a.timestamp)) ?? 0) + 1);
    const regByDay = new Map<string, number>();
    for (const r of registeredDays) regByDay.set(r.day, (regByDay.get(r.day) ?? 0) + 1);

    const series: DayPoint[] = buildDaySeries(attByDay, regByDay, firstActivity, lastActivity);

    // Leaderboard by attestation count.
    const countById = new Map<number, number>();
    for (const a of attestations) countById.set(a.projectId, (countById.get(a.projectId) ?? 0) + 1);
    const leaderboard: LeaderProject[] = [...countById.entries()]
      .map(([projectId, attestationsN]) => ({
        projectId,
        repoUrl: repoUrlById.get(projectId) ?? "",
        attestations: attestationsN,
        sealed: sealed.has(projectId),
      }))
      .sort((a, b) => b.attestations - a.attestations || a.projectId - b.projectId);

    const recent: ActivityItem[] = attestations
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 12)
      .map((a) => ({ ...a, repoUrl: repoUrlById.get(a.projectId) ?? "" }));

    return {
      projectCount: regLogs.length,
      attestationCount: attestations.length,
      sealedCount: sealed.size,
      linkedContractCount: linkLogs.length,
      uniqueOwners: owners.size,
      firstActivity,
      lastActivity,
      series,
      leaderboard,
      recent,
    };
  } catch {
    return EMPTY_STATS;
  }
}
