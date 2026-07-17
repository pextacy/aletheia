import type { Hex } from "viem";
import { account, publicClient, registryAbi, registryAddress, walletClient } from "./chain.js";
import { markSubmissionsFailed, markSubmissionsSubmitted } from "./db.js";

interface Job {
  projectId: bigint;
  pairs: Array<{ commit32: Hex; tree32: Hex }>;
  submissionIds: number[];
}

/**
 * Single serialized worker per attestor key. Nonce is fetched once at startup
 * and incremented locally; on a nonce error it re-syncs from the RPC and
 * retries once. Failures are persisted — never silently dropped.
 */
class TxQueue {
  private chain: Promise<void> = Promise.resolve();
  private nonce: number | null = null;

  enqueue(job: Job): Promise<Hex | null> {
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

  private async process(job: Job): Promise<Hex | null> {
    try {
      let txHash: Hex;
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
      await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
      markSubmissionsSubmitted(job.submissionIds, txHash);
      return txHash;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `attestation failed project=${job.projectId} commits=${job.pairs.length}: ${msg}`
      );
      markSubmissionsFailed(job.submissionIds, msg);
      // force a nonce re-sync before the next job — state is unknown after a failure
      this.nonce = null;
      return null;
    }
  }
}

export const txQueue = new TxQueue();
