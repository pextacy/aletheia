import { env } from "./env.js";
import { publicClient } from "./chain.js";
import { buildServer } from "./server.js";

// Safety net: an isolated failure (a bad repo clone, an RPC blip) must never
// take down the bridge, which is also serving webhooks. Log and keep running.
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason instanceof Error ? reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err instanceof Error ? err.stack : err);
});

const chainId = await publicClient.getChainId();
if (chainId !== Number(env.CHAIN_ID)) {
  throw new Error(`RPC chain id ${chainId} does not match CHAIN_ID env ${env.CHAIN_ID}`);
}

const app = buildServer();
await app.listen({ port: env.PORT, host: "0.0.0.0" });
