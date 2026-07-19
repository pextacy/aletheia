import type { Hex } from "viem";
import { account, registryAbi, type ChainCtx } from "./chain.js";
import { markSubmissionsFailed, markSubmissionsSubmitted } from "./db.js";

interface Job {
  projectId: bigint;
  pairs: Array<{ commit32: Hex; tree32: Hex }>;
  submissionIds: number[];
}

/**
 * Result of a queued attestation.
 * - ok: the tx confirmed successfully.
 * - retryable === true: the tx was never submitted (send threw before a hash),
 *   so no attestation landed and the caller may safely release the delivery for
 *   a genuine retry.
 * - retryable === false: a hash exists but the outcome is a revert or an
 *   indeterminate/timed-out receipt — the tx may have landed, so retrying could
 *   double-attest. The caller must NOT release the delivery; the failure is
 *   surfaced loudly via /status instead.
 */
export type SubmitResult =
  | { ok: true; txHash: Hex }
  | { ok: false; retryable: boolean };

/**
 * Single serialized worker per (attestor key, chain). Nonces are per-chain
 * account state, so each configured chain gets its own queue; within a queue
 * the nonce is fetched once and incremented locally, with one resync retry on
 * nonce errors. Failures are persisted — never silently dropped.
 */
class TxQueue {
  private chain: Promise<void> = Promise.resolve();
  private nonce: number | null = null;

  constructor(private readonly ctx: ChainCtx) {}

  enqueue(job: Job): Promise<SubmitResult> {
    const result = this.chain.then(() => this.process(job));
    // keep the chain alive regardless of individual job outcome
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async syncNonce(): Promise<number> {
    this.nonce = await this.ctx.publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    return this.nonce;
  }

  private async send(job: Job): Promise<Hex> {
    if (this.nonce === null) await this.syncNonce();
    const nonce = this.nonce as number;

    const txHash =
      job.pairs.length === 1
        ? await this.ctx.walletClient.writeContract({
            address: this.ctx.registryAddress,
            abi: registryAbi,
            functionName: "attest",
            args: [job.projectId, job.pairs[0]!.commit32, job.pairs[0]!.tree32],
            nonce,
          })
        : await this.ctx.walletClient.writeContract({
            address: this.ctx.registryAddress,
            abi: registryAbi,
            functionName: "attestBatch",
            args: [job.projectId, job.pairs.map((p) => p.commit32), job.pairs.map((p) => p.tree32)],
            nonce,
          });

    this.nonce = nonce + 1;
    return txHash;
  }

  private async process(job: Job): Promise<SubmitResult> {
    const tag = `project=${job.projectId} chain=${this.ctx.id}`;
    // Phase 1: obtain a tx hash. A failure here means nothing was submitted.
    let txHash: Hex;
    try {
      try {
        txHash = await this.send(job);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // "invalid param(eter)s" covers RPCs (e.g. the Tenderly gateway) that
        // reject eth_estimateGas outright when the explicit nonce is stale —
        // estimation precedes signing, so nothing was broadcast and a resync
        // retry is safe.
        if (/nonce too low|replacement transaction underpriced|already known|invalid param/i.test(msg)) {
          await this.syncNonce();
          txHash = await this.send(job);
        } else {
          throw err;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`attestation not submitted ${tag}: ${msg}`);
      await markSubmissionsFailed(job.submissionIds, `not submitted: ${msg}`);
      this.nonce = null; // resync before the next job — nonce state is unknown
      return { ok: false, retryable: true };
    }

    // Phase 2: a tx exists on the wire. Whatever happens now, retrying risks a
    // double attestation, so this branch never reports retryable.
    try {
      const receipt = await this.ctx.publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 60_000,
      });
      if (receipt.status === "success") {
        await markSubmissionsSubmitted(job.submissionIds, txHash);
        return { ok: true, txHash };
      }
      console.error(`attestation reverted ${tag} tx=${txHash}`);
      await markSubmissionsFailed(job.submissionIds, `reverted: ${txHash}`);
      this.nonce = null;
      return { ok: false, retryable: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`attestation receipt unknown ${tag} tx=${txHash}: ${msg}`);
      await markSubmissionsFailed(job.submissionIds, `receipt unknown (tx ${txHash}): ${msg}`);
      this.nonce = null;
      return { ok: false, retryable: false };
    }
  }
}

const queues = new Map<number, TxQueue>();

/** The serialized attestation queue for a chain — one per configured chain. */
export function queueFor(ctx: ChainCtx): TxQueue {
  let q = queues.get(ctx.id);
  if (!q) {
    q = new TxQueue(ctx);
    queues.set(ctx.id, q);
  }
  return q;
}
