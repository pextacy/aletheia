import type { Hex } from "viem";
import { account, publicClient, registryAbi, registryAddress, walletClient } from "./chain.js";
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
 * Single serialized worker per attestor key. Nonce is fetched once at startup
 * and incremented locally; on a nonce error it re-syncs from the RPC and
 * retries once. Failures are persisted — never silently dropped.
 */
class TxQueue {
  private chain: Promise<void> = Promise.resolve();
  private nonce: number | null = null;

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
    this.nonce = await publicClient.getTransactionCount({
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
        ? await walletClient.writeContract({
            address: registryAddress,
            abi: registryAbi,
            functionName: "attest",
            args: [job.projectId, job.pairs[0]!.commit32, job.pairs[0]!.tree32],
            nonce,
          })
        : await walletClient.writeContract({
            address: registryAddress,
            abi: registryAbi,
            functionName: "attestBatch",
            args: [job.projectId, job.pairs.map((p) => p.commit32), job.pairs.map((p) => p.tree32)],
            nonce,
          });

    this.nonce = nonce + 1;
    return txHash;
  }

  private async process(job: Job): Promise<SubmitResult> {
    // Phase 1: obtain a tx hash. A failure here means nothing was submitted.
    let txHash: Hex;
    try {
      try {
        txHash = await this.send(job);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/nonce too low|replacement transaction underpriced|already known/i.test(msg)) {
          await this.syncNonce();
          txHash = await this.send(job);
        } else {
          throw err;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`attestation not submitted project=${job.projectId}: ${msg}`);
      markSubmissionsFailed(job.submissionIds, `not submitted: ${msg}`);
      this.nonce = null; // resync before the next job — nonce state is unknown
      return { ok: false, retryable: true };
    }

    // Phase 2: a tx exists on the wire. Whatever happens now, retrying risks a
    // double attestation, so this branch never reports retryable.
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
      if (receipt.status === "success") {
        markSubmissionsSubmitted(job.submissionIds, txHash);
        return { ok: true, txHash };
      }
      console.error(`attestation reverted project=${job.projectId} tx=${txHash}`);
      markSubmissionsFailed(job.submissionIds, `reverted: ${txHash}`);
      this.nonce = null;
      return { ok: false, retryable: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`attestation receipt unknown project=${job.projectId} tx=${txHash}: ${msg}`);
      markSubmissionsFailed(job.submissionIds, `receipt unknown (tx ${txHash}): ${msg}`);
      this.nonce = null;
      return { ok: false, retryable: false };
    }
  }
}

export const txQueue = new TxQueue();
