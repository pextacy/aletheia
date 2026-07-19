import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, defineChain, http, parseAbi, parseAbiItem } from "viem";

function fromDeployments(): { registry?: string; block?: number } {
  try {
    const chainId = process.env.CHAIN_ID ?? "10143";
    const raw = readFileSync(join(process.cwd(), "..", "deployments", `${chainId}.json`), "utf8");
    return JSON.parse(raw) as { registry?: string; block?: number };
  } catch {
    return {};
  }
}

const deployment = fromDeployments();

export const RPC_URL = process.env.RPC_URL ?? "https://testnet-rpc.monad.xyz";
export const EXPLORER_URL = process.env.EXPLORER_URL ?? "https://testnet.monadexplorer.com";
export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 10143);
export const REGISTRY_ADDRESS = (process.env.REGISTRY_ADDRESS ?? deployment.registry ?? "") as `0x${string}`;
/** Block the registry was deployed at — the floor for every event scan. */
export const DEPLOY_BLOCK = BigInt(process.env.DEPLOY_BLOCK ?? deployment.block ?? 0);
export const HACKATHON_START = new Date("2026-07-13T13:00:00Z");

if (!/^0x[0-9a-fA-F]{40}$/.test(REGISTRY_ADDRESS)) {
  // Fail at module load: every page depends on the registry. A wrong address
  // would render an empty-but-plausible site — worse than a loud error.
  throw new Error("REGISTRY_ADDRESS env var (or deployments/<chainId>.json) is required");
}

export const registryAbi = parseAbi([
  "function registerProject(bytes32 repoHash, string repoUrl, address attestor) external returns (uint256)",
  "function projects(uint256 projectId) view returns (address owner, address attestor, bytes32 repoHash, uint64 createdAt, uint64 sealedAt)",
  "function projectByRepo(bytes32 repoHash) view returns (uint256)",
  "function projectCount() view returns (uint256)",
]);

export const events = {
  registered: parseAbiItem(
    "event ProjectRegistered(uint256 indexed projectId, address indexed owner, address attestor, bytes32 repoHash, string repoUrl, uint64 timestamp)"
  ),
  attested: parseAbiItem(
    "event Attested(uint256 indexed projectId, bytes32 indexed commitHash, bytes32 treeHash, uint64 timestamp)"
  ),
  linked: parseAbiItem(
    "event ContractLinked(uint256 indexed projectId, address indexed deployed, string label, uint64 timestamp)"
  ),
  attestorChanged: parseAbiItem("event AttestorChanged(uint256 indexed projectId, address newAttestor)"),
  sealed: parseAbiItem("event Sealed(uint256 indexed projectId, uint64 timestamp)"),
} as const;

export const CHAIN_NAME =
  CHAIN_ID === 10143 ? "Monad Testnet" : CHAIN_ID === 143 ? "Monad Mainnet" : `Chain ${CHAIN_ID}`;

export const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

export function explorerTx(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}
export function explorerAddress(addr: string): string {
  return `${EXPLORER_URL}/address/${addr}`;
}
