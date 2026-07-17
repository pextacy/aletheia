import { getVerification, saveVerification } from "./db.js";
import { countAttestations, verifyProject, type VerifyReport } from "./verify.js";

/** Re-verify at most this often even if the attestation count is unchanged. */
const MAX_AGE_SEC = 3600;

/** Max concurrent repo clones across all projects — bounds disk/network/CPU. */
const MAX_CONCURRENT_CLONES = 3;

// One in-flight verification per project — concurrent requests share the clone.
const inFlight = new Map<number, Promise<VerifyReport>>();

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
 * Cached, deduped project verification. Returns the stored report when the
 * on-chain attestation count is unchanged and the cache is fresh; otherwise
 * clones the repo and re-verifies once, sharing that work across callers.
 */
export async function getVerifyResult(projectId: number): Promise<VerifyResult> {
  const count = await countAttestations(projectId);
  const cached = getVerification(projectId);
  if (
    cached &&
    cached.attestationCount === count &&
    nowSec() - cached.verifiedAt < MAX_AGE_SEC
  ) {
    return { report: JSON.parse(cached.report) as VerifyReport, cached: true };
  }

  let pending = inFlight.get(projectId);
  if (!pending) {
    pending = (async () => {
      await acquireCloneSlot();
      try {
        const report = await verifyProject(projectId);
        report.verifiedAt = nowSec();
        saveVerification(
          projectId,
          report.attestationCount,
          JSON.stringify(report),
          report.verifiedAt
        );
        return report;
      } finally {
        releaseCloneSlot();
        // Clear the slot from inside the same promise so no extra, un-awaited
        // chain is created — a dangling `.finally()` would surface a rejected
        // clone as an unhandled rejection and crash the process.
        inFlight.delete(projectId);
      }
    })();
    inFlight.set(projectId, pending);
  }

  const report = await pending;
  return { report, cached: false };
}
