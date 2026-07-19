const REQUIRED = [
  "CHAIN_ID",
  "RPC_URL",
  "REGISTRY_ADDRESS",
  "ATTESTOR_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "DATABASE_URL",
] as const;

type RequiredKey = (typeof REQUIRED)[number];

interface OptionalEnv {
  GITHUB_TOKEN?: string;
  PORT: number;
  /** Both set ⇒ the bridge serves Monad mainnet (143) alongside the primary chain. */
  MAINNET_RPC_URL?: string;
  MAINNET_REGISTRY_ADDRESS?: string;
}

function readEnv(): Record<RequiredKey, string> & OptionalEnv {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  const out = Object.fromEntries(REQUIRED.map((k) => [k, process.env[k] as string])) as Record<
    RequiredKey,
    string
  >;
  if (!/^0x[0-9a-fA-F]{40}$/.test(out.REGISTRY_ADDRESS)) {
    throw new Error(`REGISTRY_ADDRESS is not a valid address: ${out.REGISTRY_ADDRESS}`);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(out.ATTESTOR_PRIVATE_KEY)) {
    throw new Error("ATTESTOR_PRIVATE_KEY is not a valid 32-byte hex private key");
  }
  if (!/^postgres(ql)?:\/\//i.test(out.DATABASE_URL)) {
    throw new Error("DATABASE_URL is not a postgres:// connection string");
  }

  const mainnetRpc = process.env.MAINNET_RPC_URL;
  const mainnetRegistry = process.env.MAINNET_REGISTRY_ADDRESS;
  if (!!mainnetRpc !== !!mainnetRegistry) {
    throw new Error("MAINNET_RPC_URL and MAINNET_REGISTRY_ADDRESS must be set together");
  }
  if (mainnetRegistry && !/^0x[0-9a-fA-F]{40}$/.test(mainnetRegistry)) {
    throw new Error(`MAINNET_REGISTRY_ADDRESS is not a valid address: ${mainnetRegistry}`);
  }

  return {
    ...out,
    ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}),
    ...(mainnetRpc && mainnetRegistry
      ? { MAINNET_RPC_URL: mainnetRpc, MAINNET_REGISTRY_ADDRESS: mainnetRegistry }
      : {}),
    PORT: Number(process.env.PORT ?? 8787),
  };
}

export const env = readEnv();
