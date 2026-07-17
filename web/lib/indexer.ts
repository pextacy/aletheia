import { keccak256, toBytes, type AbiEvent } from "viem";
import { DEPLOY_BLOCK, REGISTRY_ADDRESS, events, publicClient, registryAbi } from "./chain";

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

async function getLogsBisect(
  event: AbiEvent,
  projectId: bigint | undefined,
  from: bigint,
  to: bigint,
  depth = 0
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
    if (depth > 24 || to <= from) throw err;
    const mid = from + (to - from) / 2n;
    const [a, b] = await Promise.all([
      getLogsBisect(event, projectId, from, mid, depth + 1),
      getLogsBisect(event, projectId, mid + 1n, to, depth + 1),
    ]);
    return [...a, ...b];
  }
}

/** bytes32 → git object id: SHA-1 ids are the first 20 bytes, zero-padded. */
export function bytes32ToOid(value: string): string {
  const hex = value.slice(2).toLowerCase();
  return hex.endsWith("000000000000000000000000") ? hex.slice(0, 40) : hex;
}

function repoFullNameFromUrl(url: string): string | null {
  const m = url.match(/github\.com\/([^/]+\/[^/#?]+)/i);
  return m ? m[1]!.replace(/\.git$/, "") : null;
}

export async function fetchProject(projectId: number): Promise<ProjectModel | null> {
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

/**
 * Reduce any GitHub URL to the canonical `github.com/owner/repo` path the
 * registry hashes. Must stay byte-identical to RegisterFlow's canonicalizer —
 * the repoHash is keccak256 over this exact string, so any divergence would
 * make a genuinely-registered repo look absent. Returns null when the input
 * isn't a recognizable GitHub repo URL.
 */
export function canonicalRepoPath(url: string): string | null {
  const m = url
    .trim()
    .match(/^(?:https?:\/\/)?(github\.com\/[^/]+\/[^/#?]+?)(?:\.git)?\/?$/i);
  return m ? m[1]!.toLowerCase() : null;
}

/** keccak256 of the canonical repo path — the on-chain repoHash key. */
export function repoHashFromPath(path: string): `0x${string}` {
  return keccak256(toBytes(path));
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
