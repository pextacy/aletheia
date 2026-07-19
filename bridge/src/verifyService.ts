import type { ChainCtx } from "./chain.js";
import { getVerification, saveVerification, touchVerificationScan } from "./db.js";
import { countAttestationsSince, verifyProject, type VerifyReport } from "./verify.js";

/** Serve the cached report without touching the chain at all inside this window. */
const FRESH_SEC = 300;

/** Re-verify at most this often even if the attestation count is unchanged. */
const MAX_AGE_SEC = 3600;

/** Max concurrent repo clones across all projects — bounds disk/network/CPU. */
const MAX_CONCURRENT_CLONES = 3;

// One in-flight verification per (chain, project) — concurrent requests share
// the clone.
const inFlight = new Map<string, Promise<VerifyReport>>();

// Global semaphore so a burst of distinct-project verifications can't spawn an
// unbounded number of simultaneous clones and exhaust the host.
let activeClones = 0;
const cloneWaiters: Array<() => void> = [];

async function acquireCloneSlot(): Promise<void> {
  if (activeClones < MAX_CONCURRENT_CLONES) {
    activeClones++;
    return;
  }
  await new Promise<void>((resolve) => cloneWaiters.push(resolve));
  activeClones++;
}

function releaseCloneSlot(): void {
  activeClones--;
  const next = cloneWaiters.shift();
  if (next) next();
}

export interface VerifyResult {
  report: VerifyReport;
  cached: boolean;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Cached, deduped project verification, three tiers so the steady state never
 * re-walks the chain on a range-capped RPC:
 * 1. fresh cache (< FRESH_SEC): serve stored report, zero chain calls;
 * 2. staleness probe: scan only blocks after the last covered one — no new
 *    attestations and not too old ⇒ still valid, advance the floor;
 * 3. full re-verify (clone + recompute), shared across concurrent callers.
 */
export async function getVerifyResult(ctx: ChainCtx, projectId: number): Promise<VerifyResult> {
  const cached = await getVerification(ctx.id, projectId);
  const age = cached ? nowSec() - cached.verifiedAt : Infinity;
  if (cached && age < FRESH_SEC) {
    return { report: JSON.parse(cached.report) as VerifyReport, cached: true };
  }
  if (cached && cached.lastBlock > 0 && age < MAX_AGE_SEC) {
    const { count, latest } = await countAttestationsSince(
      ctx,
      projectId,
      BigInt(cached.lastBlock) + 1n
    );
    if (count === 0) {
      await touchVerificationScan(ctx.id, projectId, Number(latest));
      return { report: JSON.parse(cached.report) as VerifyReport, cached: true };
    }
  }

  const key = `${ctx.id}:${projectId}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      await acquireCloneSlot();
      try {
        const report = await verifyProject(ctx, projectId);
        report.verifiedAt = nowSec();
        await saveVerification(
          ctx.id,
          projectId,
          report.attestationCount,
          JSON.stringify(report),
          report.verifiedAt,
          report.scannedToBlock
        );
        return report;
      } finally {
        releaseCloneSlot();
        // Clear the slot from inside the same promise so no extra, un-awaited
        // chain is created — a dangling `.finally()` would surface a rejected
        // clone as an unhandled rejection and crash the process.
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, pending);
  }

  const report = await pending;
  return { report, cached: false };
}
