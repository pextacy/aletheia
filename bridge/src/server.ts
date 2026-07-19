import Fastify, { type FastifyRequest } from "fastify";
import { formatEther, verifyMessage, type Hex } from "viem";
import {
  account,
  chainById,
  chains,
  gitOidToBytes32,
  lookupRegistrations,
  primaryChain,
  registryAbi,
  type ChainCtx,
} from "./chain.js";
import {
  getWebhookSecret,
  recentSubmissions,
  recordDelivery,
  recordSubmission,
  releaseDelivery,
  setWebhookSecret,
} from "./db.js";
import { env } from "./env.js";
import { fetchCompareRange, fetchTreeSha, type CommitPair } from "./github.js";
import { verifySignature } from "./hmac.js";
import { queueFor } from "./queue.js";
import { getVerifyResult } from "./verifyService.js";

interface PushPayload {
  repository?: { full_name?: string };
  commits?: Array<{ id: string; tree_id?: string; distinct?: boolean }>;
  head_commit?: { id: string; tree_id?: string } | null;
  before?: string;
  after?: string;
  forced?: boolean;
}

const ZERO_SHA = /^0+$/;

/** Commit/tree pairs for the push, falling back to the Compare API when GitHub truncated the list. */
async function resolveCommitPairs(payload: PushPayload, repo: string): Promise<CommitPair[]> {
  const commits = payload.commits ?? [];
  const head = payload.head_commit;

  const truncated = head != null && !commits.some((c) => c.id === head.id);
  // Compare needs a real base. On a new branch (or a first push to a ref)
  // `before` is all-zeros — feeding that to /compare 404s, so only take the
  // Compare path when the base is a real commit.
  const hasBase = !!payload.before && !ZERO_SHA.test(payload.before);
  if (truncated && hasBase && payload.after) {
    return fetchCompareRange(repo, payload.before!, payload.after);
  }

  const pairs: CommitPair[] = [];
  for (const c of commits) {
    pairs.push({ commit: c.id, tree: c.tree_id ?? (await fetchTreeSha(repo, c.id)) });
  }
  // Truncated with no usable base (new branch >20 commits): we cannot recover
  // the intermediate commits, but the head is the meaningful anchor — attest it
  // rather than dropping the push or 404-ing on Compare.
  if (head && !commits.some((c) => c.id === head.id)) {
    pairs.push({ commit: head.id, tree: head.tree_id ?? (await fetchTreeSha(repo, head.id)) });
  }
  return pairs;
}

/** Resolve ?chain= to a configured chain (default: the primary). */
function chainFromQuery(req: FastifyRequest): ChainCtx | null {
  const raw = (req.query as { chain?: string }).chain;
  if (raw === undefined || raw === "") return primaryChain;
  const id = Number(raw);
  if (!Number.isInteger(id)) return null;
  return chainById(id) ?? null;
}

export function buildServer() {
  // Cap the request body: the raw payload is buffered before the HMAC check, so
  // an explicit limit bounds pre-auth memory use. Real GitHub push payloads are
  // well under this; 5 MB leaves generous headroom without inviting abuse.
  const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });

  // Preserve the raw body — HMAC is computed over the exact bytes GitHub sent.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/webhook/github", async (req, reply) => {
    const rawBody = req.body as Buffer;
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const event = req.headers["x-github-event"] as string | undefined;
    const deliveryId = req.headers["x-github-delivery"] as string | undefined;

    // The payload is untrusted until the HMAC check below passes; it is parsed
    // first only to learn which project's webhook secret applies.
    let payload: PushPayload;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as PushPayload;
    } catch {
      return reply.status(422).send({ error: "invalid JSON payload" });
    }

    const repo = payload.repository?.full_name;
    // The repo may be registered on any configured chain — possibly several.
    const registrations = repo ? await lookupRegistrations(repo) : [];
    const active = registrations.filter((r) => r.projectId > 0n);

    // Candidate secrets: each chain's per-project secret, then the global one.
    // The HMAC must match one of them; each check is constant-time.
    const candidates: string[] = [];
    for (const { ctx, projectId } of active) {
      const s = await getWebhookSecret(ctx.id, Number(projectId));
      if (s) candidates.push(s);
    }
    candidates.push(env.GITHUB_WEBHOOK_SECRET);

    if (!candidates.some((secret) => verifySignature(rawBody, signature, secret))) {
      req.log.warn({ deliveryId, repo }, "webhook rejected: invalid HMAC signature");
      return reply.status(401).send({ error: "invalid signature" });
    }
    if (event === "ping") return reply.status(204).send();
    if (event !== "push") {
      req.log.warn({ event, deliveryId }, "webhook rejected: unsupported event type");
      return reply.status(422).send({ error: `unsupported event: ${event}` });
    }
    if (!deliveryId) {
      return reply.status(422).send({ error: "missing X-GitHub-Delivery" });
    }
    if (!repo) return reply.status(422).send({ error: "missing repository.full_name" });
    if (active.length === 0) {
      req.log.warn({ repo, deliveryId }, "webhook rejected: repo not registered on any chain");
      return reply.status(422).send({ error: `repo not registered: ${repo}` });
    }

    const pairs = await resolveCommitPairs(payload, repo);
    if (pairs.length === 0) {
      // branch deletions and tag-only pushes carry no commits — nothing to attest
      return reply.status(200).send({ status: "no commits" });
    }
    const forced = payload.forced === true;
    const jobPairs = pairs.map((p) => ({
      commit32: gitOidToBytes32(p.commit),
      tree32: gitOidToBytes32(p.tree),
    }));

    // Attest on every chain the repo is registered on. Chains are independent:
    // each has its own delivery receipt, submissions, queue, and failure state.
    const results: Array<{
      chainId: number;
      status: "submitted" | "duplicate" | "failed";
      txHash?: Hex;
      retryable?: boolean;
    }> = [];
    for (const { ctx, projectId } of active) {
      if (!(await recordDelivery(deliveryId, ctx.id, repo))) {
        req.log.info({ deliveryId, chainId: ctx.id }, "duplicate delivery, skipping");
        results.push({ chainId: ctx.id, status: "duplicate" });
        continue;
      }
      const submissionIds: number[] = [];
      for (const p of pairs) {
        submissionIds.push(
          await recordSubmission(ctx.id, projectId, deliveryId, p.commit, p.tree, forced)
        );
      }
      const result = await queueFor(ctx).enqueue({ projectId, pairs: jobPairs, submissionIds });
      if (result.ok) {
        results.push({ chainId: ctx.id, status: "submitted", txHash: result.txHash });
      } else {
        // Only release the delivery when nothing was submitted (retryable) — then
        // GitHub's redelivery reprocesses it instead of being rejected as a
        // duplicate. If a tx exists but reverted or the receipt is unknown,
        // retrying could double-attest, so the delivery stays recorded and the
        // failure is surfaced via /status. Either way, never a silent success.
        if (result.retryable) await releaseDelivery(deliveryId, ctx.id);
        results.push({ chainId: ctx.id, status: "failed", retryable: result.retryable });
      }
    }

    const failed = results.filter((r) => r.status === "failed");
    if (failed.length > 0) {
      return reply.status(502).send({
        error: failed.every((f) => f.retryable)
          ? "attestation not submitted; retry the delivery — see /status"
          : "attestation failed after submission; see /status before retrying",
        results,
      });
    }
    if (results.every((r) => r.status === "duplicate")) {
      return reply.status(200).send({ status: "duplicate", results });
    }
    const first = results.find((r) => r.status === "submitted");
    return reply.status(200).send({ txHash: first?.txHash, commits: pairs.length, results });
  });

  // Bind a per-project webhook secret. Only the on-chain project owner can do
  // this: the secret must arrive with an EIP-191 signature over
  // "aletheia-webhook-secret:<projectId>:<secret>" from the owner key.
  // chainId selects which chain's registry the project lives on (default:
  // the primary chain).
  app.post("/webhook/register-secret", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    let body: { projectId?: number; secret?: string; signature?: string; chainId?: number };
    try {
      body = JSON.parse((req.body as Buffer).toString("utf8")) as typeof body;
    } catch {
      return reply.status(422).send({ error: "invalid JSON" });
    }
    const { projectId, secret, signature } = body;
    if (
      !Number.isInteger(projectId) ||
      (projectId as number) < 1 ||
      typeof secret !== "string" ||
      !/^[0-9a-f]{64}$/.test(secret) ||
      typeof signature !== "string"
    ) {
      return reply.status(422).send({ error: "expected {projectId, secret(64 hex), signature}" });
    }
    const ctx = body.chainId === undefined ? primaryChain : chainById(body.chainId);
    if (!ctx) {
      return reply.status(422).send({ error: `chain not served here: ${body.chainId}` });
    }

    const [owner] = await ctx.publicClient.readContract({
      address: ctx.registryAddress,
      abi: registryAbi,
      functionName: "projects",
      args: [BigInt(projectId as number)],
    });
    if (owner === "0x0000000000000000000000000000000000000000") {
      return reply.status(422).send({ error: "unknown project" });
    }

    const valid = await verifyMessage({
      address: owner,
      message: `aletheia-webhook-secret:${projectId}:${secret}`,
      signature: signature as Hex,
    });
    if (!valid) {
      req.log.warn({ projectId, chainId: ctx.id }, "register-secret rejected: bad owner signature");
      return reply.status(401).send({ error: "signature does not match project owner" });
    }

    await setWebhookSecret(ctx.id, projectId as number, secret);
    return reply.send({ ok: true });
  });

  app.options("/webhook/register-secret", async (_req, reply) => {
    return reply
      .header("Access-Control-Allow-Origin", "*")
      .header("Access-Control-Allow-Methods", "POST, OPTIONS")
      .header("Access-Control-Allow-Headers", "Content-Type")
      .status(204)
      .send();
  });

  app.get("/healthz", async (_req, reply) => {
    const perChain = await Promise.all(
      chains.map(async (ctx) => {
        try {
          const [blockNumber, balance] = await Promise.all([
            ctx.publicClient.getBlockNumber(),
            ctx.publicClient.getBalance({ address: account.address }),
          ]);
          const balanceMon = Number(formatEther(balance));
          return {
            chainId: ctx.id,
            name: ctx.name,
            ok: true,
            blockNumber: blockNumber.toString(),
            balanceMon,
            lowBalance: balanceMon < 0.5,
          };
        } catch (err) {
          return {
            chainId: ctx.id,
            name: ctx.name,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );
    const ok = perChain.every((c) => c.ok);
    const primary = perChain[0]!;
    return reply.status(ok ? 200 : 502).send({
      ok,
      attestor: account.address,
      // legacy top-level fields mirror the primary chain
      blockNumber: "blockNumber" in primary ? primary.blockNumber : undefined,
      balanceMon: "balanceMon" in primary ? primary.balanceMon : undefined,
      lowBalance: "lowBalance" in primary ? primary.lowBalance : undefined,
      chains: perChain,
    });
  });

  app.get<{ Params: { projectId: string } }>("/status/:projectId", async (req, reply) => {
    const id = Number(req.params.projectId);
    if (!Number.isInteger(id) || id < 1) {
      return reply.status(422).send({ error: "invalid project id" });
    }
    const ctx = chainFromQuery(req);
    if (!ctx) return reply.status(422).send({ error: "chain not served here" });
    return reply.send({
      projectId: id,
      chainId: ctx.id,
      submissions: await recentSubmissions(ctx.id, id),
    });
  });

  // Independent verification: clone the repo, recompute every commit + tree
  // hash, and diff against the chain. Cached by attestation count so repeated
  // views don't re-clone. Read-only; served to the web proof page and anyone.
  app.get<{ Params: { projectId: string } }>("/verify/:projectId", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    const id = Number(req.params.projectId);
    if (!Number.isInteger(id) || id < 1) {
      return reply.status(422).send({ error: "invalid project id" });
    }
    const ctx = chainFromQuery(req);
    if (!ctx) return reply.status(422).send({ error: "chain not served here" });
    try {
      const { report, cached } = await getVerifyResult(ctx, id);
      return reply.header("X-Aletheia-Cache", cached ? "hit" : "miss").send(report);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/does not exist/.test(msg)) {
        return reply.status(404).send({ error: msg });
      }
      req.log.error({ projectId: id, chainId: ctx.id, err: msg }, "verification failed");
      return reply.status(502).send({ error: `verification failed: ${msg}` });
    }
  });

  return app;
}
