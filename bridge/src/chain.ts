import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  toBytes,
  type AbiEvent,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env.js";

export const registryAbi = parseAbi([
  "function attest(uint256 projectId, bytes32 commitHash, bytes32 treeHash) external",
  "function attestBatch(uint256 projectId, bytes32[] commitHashes, bytes32[] treeHashes) external",
  "function projectByRepo(bytes32 repoHash) view returns (uint256)",
  "function projects(uint256 projectId) view returns (address owner, address attestor, bytes32 repoHash, uint64 createdAt, uint64 sealedAt)",
]);

export const registeredEvent = parseAbiItem(
  "event ProjectRegistered(uint256 indexed projectId, address indexed owner, address attestor, bytes32 repoHash, string repoUrl, uint64 timestamp)"
);
export const attestedEvent = parseAbiItem(
  "event Attested(uint256 indexed projectId, bytes32 indexed commitHash, bytes32 treeHash, uint64 timestamp)"
);

export function chainName(id: number): string {
  return id === 10143 ? "Monad Testnet" : id === 143 ? "Monad Mainnet" : `Chain ${id}`;
}

/** One configured chain the bridge serves: clients + registry, all per-chain. */
export interface ChainCtx {
  id: number;
  name: string;
  rpcUrl: string;
  registryAddress: Hex;
  publicClient: PublicClient;
  walletClient: WalletClient<ReturnType<typeof http>, Chain, Account>;
}

export const account = privateKeyToAccount(env.ATTESTOR_PRIVATE_KEY as Hex);

function buildCtx(id: number, rpcUrl: string, registryAddress: Hex): ChainCtx {
  const chain = defineChain({
    id,
    name: chainName(id),
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return {
    id,
    name: chainName(id),
    rpcUrl,
    registryAddress,
    publicClient: createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient,
    walletClient: createWalletClient({ account, chain, transport: http(rpcUrl) }),
  };
}

/**
 * Every chain this bridge instance serves. The primary chain comes from the
 * required CHAIN_ID/RPC_URL/REGISTRY_ADDRESS envs; Monad mainnet joins it when
 * MAINNET_RPC_URL + MAINNET_REGISTRY_ADDRESS are both set (one process, both
 * chains — per-chain tx queues and chain-scoped database rows keep them apart).
 */
export const chains: ChainCtx[] = [
  buildCtx(Number(env.CHAIN_ID), env.RPC_URL, env.REGISTRY_ADDRESS as Hex),
  ...(env.MAINNET_RPC_URL && env.MAINNET_REGISTRY_ADDRESS
    ? [buildCtx(143, env.MAINNET_RPC_URL, env.MAINNET_REGISTRY_ADDRESS as Hex)]
    : []),
];

export const primaryChain = chains[0]!;

export function chainById(id: number): ChainCtx | undefined {
  return chains.find((c) => c.id === id);
}

/** keccak256 of the lowercase canonical repo path, e.g. "github.com/pextacy/aletheia". */
export function repoHashOf(fullName: string): Hex {
  return keccak256(toBytes(`github.com/${fullName.toLowerCase()}`));
}

/** Git object id (40-char SHA-1 or 64-char SHA-256 hex) → left-aligned zero-padded bytes32. */
export function gitOidToBytes32(oid: string): Hex {
  const clean = oid.toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(clean) && !/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`Not a valid git object id: ${oid}`);
  }
  return `0x${clean.padEnd(64, "0")}` as Hex;
}

export async function lookupProjectId(ctx: ChainCtx, repoFullName: string): Promise<bigint> {
  return ctx.publicClient.readContract({
    address: ctx.registryAddress,
    abi: registryAbi,
    functionName: "projectByRepo",
    args: [repoHashOf(repoFullName)],
  });
}

/** The repo's registration on every configured chain (projectId 0 = not registered). */
export async function lookupRegistrations(
  repoFullName: string
): Promise<Array<{ ctx: ChainCtx; projectId: bigint }>> {
  const out: Array<{ ctx: ChainCtx; projectId: bigint }> = [];
  for (const ctx of chains) {
    out.push({ ctx, projectId: await lookupProjectId(ctx, repoFullName) });
  }
  return out;
}

/** bytes32 attestation value → git object id, per the repo's object format. */
export function bytes32ToOid(value: Hex, objectFormat: "sha1" | "sha256"): string {
  const hex = value.slice(2).toLowerCase();
  return objectFormat === "sha1" ? hex.slice(0, 40) : hex;
}

interface RawLog {
  args: Record<string, unknown>;
  blockNumber: bigint | null;
}


// Global cap on in-flight getLogs calls: full parallel bisection bursts into
// rate limits, fully sequential walks take minutes on a 100-block cap. Four
// concurrent windows is fast without tripping public-RPC throttles.
const LOG_CONCURRENCY = 4;
let inFlightLogs = 0;
const logWaiters: Array<() => void> = [];
async function logSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlightLogs >= LOG_CONCURRENCY) {
    await new Promise<void>((resolve) => logWaiters.push(resolve));
  }
  inFlightLogs++;
  try {
    return await fn();
  } finally {
    inFlightLogs--;
    const next = logWaiters.shift();
    if (next) next();
  }
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

/**
 * getLogs over [from, to], bisecting on RPC range-limit errors so it works
 * against any provider cap (Monad's public RPC allows 100 blocks).
 */
export async function getLogsBisect(
  ctx: ChainCtx,
  event: AbiEvent,
  projectId: bigint,
  from: bigint,
  to: bigint,
  depth = 0,
  attempt = 0
): Promise<RawLog[]> {
  try {
    const logs = await logSlot(() =>
      ctx.publicClient.getLogs({
        address: ctx.registryAddress,
        event,
        args: { projectId } as never,
        fromBlock: from,
        toBlock: to,
      })
    );
    return logs as unknown as RawLog[];
  } catch (err) {
    if (isRateLimit(err)) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return getLogsBisect(ctx, event, projectId, from, to, depth, attempt + 1);
    }
    if (depth > 24 || to <= from) throw err;
    // parallel halves, bounded by the global logSlot semaphore
    const mid = from + (to - from) / 2n;
    const [a, b] = await Promise.all([
      getLogsBisect(ctx, event, projectId, from, mid, depth + 1),
      getLogsBisect(ctx, event, projectId, mid + 1n, to, depth + 1),
    ]);
    return [...a, ...b];
  }
}

/** Earliest block whose timestamp ≥ targetTs — floors event scans cheaply. */
export async function findBlockByTimestamp(
  ctx: ChainCtx,
  targetTs: bigint,
  latest: bigint
): Promise<bigint> {
  let lo = 0n;
  let hi = latest;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    let ts: bigint;
    try {
      ts = (await ctx.publicClient.getBlock({ blockNumber: mid })).timestamp;
    } catch {
      // Non-archive RPCs prune old blocks. A missing block is by definition
      // older than anything we're searching for, so search upward.
      lo = mid + 1n;
      continue;
    }
    if (ts < targetTs) lo = mid + 1n;
    else hi = mid;
  }
  return lo;
}
