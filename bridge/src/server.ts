import { createHmac, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import { formatEther } from "viem";
import { account, gitOidToBytes32, lookupProjectId, publicClient } from "./chain.js";
import { recentSubmissions, recordDelivery, recordSubmission } from "./db.js";
import { env } from "./env.js";
import { fetchCompareRange, fetchTreeSha, type CommitPair } from "./github.js";
import { txQueue } from "./queue.js";

interface PushPayload {
  repository?: { full_name?: string };
  commits?: Array<{ id: string; tree_id?: string; distinct?: boolean }>;
  head_commit?: { id: string; tree_id?: string } | null;
  before?: string;
  after?: string;
  forced?: boolean;
}

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const got = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Commit/tree pairs for the push, falling back to the Compare API when GitHub truncated the list. */
async function resolveCommitPairs(payload: PushPayload, repo: string): Promise<CommitPair[]> {
  const commits = payload.commits ?? [];
  const head = payload.head_commit;

  const truncated = head != null && !commits.some((c) => c.id === head.id);
  if (truncated && payload.before && payload.after) {
    return fetchCompareRange(repo, payload.before, payload.after);
  }

  const pairs: CommitPair[] = [];
  for (const c of commits) {
    pairs.push({ commit: c.id, tree: c.tree_id ?? (await fetchTreeSha(repo, c.id)) });
  }
  return pairs;
}

export function buildServer() {
  const app = Fastify({ logger: true });

  // Preserve the raw body — HMAC is computed over the exact bytes GitHub sent.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/webhook/github", async (req, reply) => {
    const rawBody = req.body as Buffer;
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const event = req.headers["x-github-event"] as string | undefined;
    const deliveryId = req.headers["x-github-delivery"] as string | undefined;

    if (!verifySignature(rawBody, signature)) {
      req.log.warn({ deliveryId }, "webhook rejected: invalid HMAC signature");
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

    let payload: PushPayload;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as PushPayload;
    } catch {
      return reply.status(422).send({ error: "invalid JSON payload" });
    }

    const repo = payload.repository?.full_name;
    if (!repo) return reply.status(422).send({ error: "missing repository.full_name" });

    const projectId = await lookupProjectId(repo);
    if (projectId === 0n) {
      req.log.warn({ repo, deliveryId }, "webhook rejected: repo not registered");
      return reply.status(422).send({ error: `repo not registered: ${repo}` });
    }

    if (!recordDelivery(deliveryId, repo)) {
      req.log.info({ deliveryId }, "duplicate delivery, skipping");
      return reply.status(200).send({ status: "duplicate" });
    }

    const pairs = await resolveCommitPairs(payload, repo);
    if (pairs.length === 0) {
      // branch deletions and tag-only pushes carry no commits — nothing to attest
      return reply.status(200).send({ status: "no commits" });
    }

    const forced = payload.forced === true;
    const submissionIds = pairs.map((p) =>
      recordSubmission(projectId, deliveryId, p.commit, p.tree, forced)
    );
    const jobPairs = pairs.map((p) => ({
      commit32: gitOidToBytes32(p.commit),
      tree32: gitOidToBytes32(p.tree),
    }));

    const txHash = await txQueue.enqueue({ projectId, pairs: jobPairs, submissionIds });
    if (txHash === null) {
      return reply.status(502).send({ error: "attestation transaction failed; see /status" });
    }
    return reply.status(200).send({ txHash, commits: pairs.length });
  });

  app.get("/healthz", async (_req, reply) => {
    const [blockNumber, balance] = await Promise.all([
      publicClient.getBlockNumber(),
      publicClient.getBalance({ address: account.address }),
    ]);
    const balanceMon = Number(formatEther(balance));
    return reply.send({
      ok: true,
      blockNumber: blockNumber.toString(),
      attestor: account.address,
      balanceMon,
      lowBalance: balanceMon < 0.5,
    });
  });

  app.get<{ Params: { projectId: string } }>("/status/:projectId", async (req, reply) => {
    const id = Number(req.params.projectId);
    if (!Number.isInteger(id) || id < 1) {
      return reply.status(422).send({ error: "invalid project id" });
    }
    return reply.send({ projectId: id, submissions: recentSubmissions(id) });
  });

  return app;
}
