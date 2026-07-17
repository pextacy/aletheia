import type { AbiEvent } from "viem";
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
