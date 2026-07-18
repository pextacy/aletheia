const REQUIRED = [
  "CHAIN_ID",
  "RPC_URL",
  "REGISTRY_ADDRESS",
  "ATTESTOR_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "DATABASE_URL",
] as const;

type RequiredKey = (typeof REQUIRED)[number];

function readEnv(): Record<RequiredKey, string> & { GITHUB_TOKEN?: string; PORT: number } {
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
  return {
    ...out,
    ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}),
    PORT: Number(process.env.PORT ?? 8787),
  };
}

export const env = readEnv();
