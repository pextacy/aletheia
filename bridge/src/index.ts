import { env } from "./env.js";
import { chains } from "./chain.js";
import { closeDb, ensureDb } from "./db.js";
import { buildServer } from "./server.js";

// Safety net: an isolated failure (a bad repo clone, an RPC blip) must never
// take down the bridge, which is also serving webhooks. Log and keep running.
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason instanceof Error ? reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err instanceof Error ? err.stack : err);
});

// Every configured chain's RPC must actually be that chain — a mismatch would
// sign transactions for the wrong network. env.CHAIN_ID anchors the primary.
for (const ctx of chains) {
  const chainId = await ctx.publicClient.getChainId();
  if (chainId !== ctx.id) {
    throw new Error(`RPC chain id ${chainId} does not match configured chain ${ctx.id} (${ctx.name})`);
  }
}
if (chains[0]!.id !== Number(env.CHAIN_ID)) {
  throw new Error(`primary chain mismatch: ${chains[0]!.id} != CHAIN_ID env ${env.CHAIN_ID}`);
}

// Fail fast if Neon is unreachable or the schema can't be created.
await ensureDb();

const app = buildServer();
await app.listen({ port: env.PORT, host: "0.0.0.0" });

// Graceful shutdown: on a platform restart/deploy (SIGTERM) or Ctrl-C (SIGINT),
// stop accepting connections, drain in-flight requests, and close the Postgres
// pool so no query is left mid-write.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received — shutting down`);
    const timer = setTimeout(() => {
      console.error("shutdown timed out, forcing exit");
      process.exit(1);
    }, 10_000);
    timer.unref();
    app
      .close()
      .then(() => closeDb())
      .then(() => {
        console.log("shutdown complete");
        process.exit(0);
      })
      .catch((err) => {
        console.error("error during shutdown:", err);
        closeDb()
          .catch(() => undefined)
          .finally(() => process.exit(1));
      });
  });
}
