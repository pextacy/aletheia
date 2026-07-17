import { createHmac, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import { formatEther, verifyMessage, type Hex } from "viem";
import {
  account,
  gitOidToBytes32,
  lookupProjectId,
  publicClient,
  registryAbi,
  registryAddress,
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
import { txQueue } from "./queue.js";

interface PushPayload {
  repository?: { full_name?: string };
  commits?: Array<{ id: string; tree_id?: string; distinct?: boolean }>;
  head_commit?: { id: string; tree_id?: string } | null;
  before?: string;
  after?: string;
  forced?: boolean;
}

function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
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

    // The payload is untrusted until the HMAC check below passes; it is parsed
    // first only to learn which project's webhook secret applies.
    let payload: PushPayload;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as PushPayload;
    } catch {
      return reply.status(422).send({ error: "invalid JSON payload" });
    }

    const repo = payload.repository?.full_name;
    const projectId = repo ? await lookupProjectId(repo) : 0n;
    const projectSecret = projectId > 0n ? getWebhookSecret(Number(projectId)) : null;
    const secret = projectSecret ?? env.GITHUB_WEBHOOK_SECRET;

    if (!verifySignature(rawBody, signature, secret)) {
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
      // The attestation never landed. Release the delivery ID so GitHub's
      // redelivery (or a manual redeliver) reprocesses it instead of being
      // rejected as a duplicate — the failed submission rows stay for /status.
      releaseDelivery(deliveryId);
      return reply.status(502).send({ error: "attestation transaction failed; see /status" });
    }
    return reply.status(200).send({ txHash, commits: pairs.length });
  });

  // Bind a per-project webhook secret. Only the on-chain project owner can do
  // this: the secret must arrive with an EIP-191 signature over
  // "aletheia-webhook-secret:<projectId>:<secret>" from the owner key.
  app.post("/webhook/register-secret", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    let body: { projectId?: number; secret?: string; signature?: string };
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

    const [owner] = await publicClient.readContract({
      address: registryAddress,
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
      req.log.warn({ projectId }, "register-secret rejected: bad owner signature");
      return reply.status(401).send({ error: "signature does not match project owner" });
    }

    setWebhookSecret(projectId as number, secret);
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
