import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import {
  CHAIN_ID,
  CHAIN_NAME,
  DEPLOY_BLOCK,
  EXPLORER_URL,
  REGISTRY_ADDRESS,
  RPC_URL,
  publicClient,
} from "./chain";

// Multi-chain registry: the site serves every configured chain from ONE
// deployment. The primary chain comes from the existing env set (CHAIN_ID,
// RPC_URL, …) so single-chain setups behave exactly as before; Monad mainnet
// (143) joins it when MAINNET_REGISTRY_ADDRESS is set (or deployments/143.json
// exists locally). Pages select a chain with ?chain=<id>, defaulting to the
// primary — all pre-multi-chain URLs keep their meaning.

export interface ChainConfig {
  id: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  registryAddress: `0x${string}`;
  deployBlock: bigint;
  client: PublicClient;
}

function nameOf(id: number): string {
  return id === 10143 ? "Monad Testnet" : id === 143 ? "Monad Mainnet" : `Chain ${id}`;
}

function buildClient(id: number, rpcUrl: string): PublicClient {
  const chain = defineChain({
    id,
    name: nameOf(id),
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

function mainnetConfig(): ChainConfig | null {
  if (CHAIN_ID === 143) return null; // the primary already is mainnet
  let registry = process.env.MAINNET_REGISTRY_ADDRESS ?? "";
  let block = process.env.MAINNET_DEPLOY_BLOCK ?? "";
  if (!registry) {
    try {
      const raw = readFileSync(join(process.cwd(), "..", "deployments", "143.json"), "utf8");
      const d = JSON.parse(raw) as { registry?: string; block?: number };
      registry = d.registry ?? "";
      block = String(d.block ?? "");
    } catch {
      // mainnet simply not configured
    }
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(registry)) return null;
  const rpcUrl = process.env.MAINNET_RPC_URL ?? "https://rpc.monad.xyz";
  return {
    id: 143,
    name: nameOf(143),
    rpcUrl,
    explorerUrl: process.env.MAINNET_EXPLORER_URL ?? "https://monadexplorer.com",
    registryAddress: registry as `0x${string}`,
    deployBlock: BigInt(block || 0),
    client: buildClient(143, rpcUrl),
  };
}

const primary: ChainConfig = {
  id: CHAIN_ID,
  name: CHAIN_NAME,
  rpcUrl: RPC_URL,
  explorerUrl: EXPLORER_URL,
  registryAddress: REGISTRY_ADDRESS,
  deployBlock: DEPLOY_BLOCK,
  client: publicClient,
};

const mainnet = mainnetConfig();
export const chainConfigs: ChainConfig[] = [primary, ...(mainnet ? [mainnet] : [])];

export const defaultChain = primary;

/** True when more than one chain is configured — drives the chain switcher UI. */
export const multiChain = chainConfigs.length > 1;

/** Resolve a ?chain= query value to a configured chain; anything else → primary. */
export function resolveChain(param: string | string[] | undefined): ChainConfig {
  const raw = Array.isArray(param) ? param[0] : param;
  if (!raw) return defaultChain;
  const id = Number(raw);
  return chainConfigs.find((c) => c.id === id) ?? defaultChain;
}

/** Query-string suffix that pins a link to `cfg` ("" on the default chain). */
export function chainSuffix(cfg: ChainConfig): string {
  return cfg.id === defaultChain.id ? "" : `?chain=${cfg.id}`;
}

export function explorerTxOn(cfg: ChainConfig, hash: string): string {
  return `${cfg.explorerUrl}/tx/${hash}`;
}

export function explorerAddressOn(cfg: ChainConfig, addr: string): string {
  return `${cfg.explorerUrl}/address/${addr}`;
}
