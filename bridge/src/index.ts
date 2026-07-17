import { env } from "./env.js";
import { publicClient } from "./chain.js";
import { buildServer } from "./server.js";

const chainId = await publicClient.getChainId();
if (chainId !== Number(env.CHAIN_ID)) {
  throw new Error(`RPC chain id ${chainId} does not match CHAIN_ID env ${env.CHAIN_ID}`);
}

const app = buildServer();
await app.listen({ port: env.PORT, host: "0.0.0.0" });
