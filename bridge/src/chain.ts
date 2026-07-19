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

const chain = defineChain({
  id: Number(env.CHAIN_ID),
  name: Number(env.CHAIN_ID) === 10143 ? "Monad Testnet" : `Chain ${env.CHAIN_ID}`,
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [env.RPC_URL] } },
});

export const account = privateKeyToAccount(env.ATTESTOR_PRIVATE_KEY as Hex);
export const publicClient = createPublicClient({ chain, transport: http(env.RPC_URL) });
export const walletClient = createWalletClient({ account, chain, transport: http(env.RPC_URL) });
export const registryAddress = env.REGISTRY_ADDRESS as Hex;

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

export async function lookupProjectId(repoFullName: string): Promise<bigint> {
  return publicClient.readContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: "projectByRepo",
    args: [repoHashOf(repoFullName)],
  });
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

/**
 * getLogs over [from, to], bisecting on RPC range-limit errors so it works
 * against any provider cap (Monad's public RPC allows 100 blocks).
 */
export async function getLogsBisect(
  event: AbiEvent,
  projectId: bigint,
  from: bigint,
  to: bigint,
  depth = 0
): Promise<RawLog[]> {
  try {
    const logs = await publicClient.getLogs({
      address: registryAddress,
      event,
      args: { projectId } as never,
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

/** Earliest block whose timestamp ≥ targetTs — floors event scans cheaply. */
export async function findBlockByTimestamp(targetTs: bigint, latest: bigint): Promise<bigint> {
  let lo = 0n;
  let hi = latest;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    let ts: bigint;
    try {
      ts = (await publicClient.getBlock({ blockNumber: mid })).timestamp;
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
