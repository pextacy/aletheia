import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseAbi,
  toBytes,
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
