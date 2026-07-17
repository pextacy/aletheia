import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import {
  attestedEvent,
  bytes32ToOid,
  findBlockByTimestamp,
  getLogsBisect,
  publicClient,
  registeredEvent,
  registryAbi,
  registryAddress,
} from "./chain.js";
import { normalizeGithubHttps } from "./repoUrl.js";

export type Verdict = "verified" | "missing" | "mismatched";

export interface CommitVerdict {
  commit: string;
  attestedTree: string;
  actualTree: string | null;
  attestedAt: number;
  status: Verdict;
}

export interface VerifyReport {
  projectId: number;
  repoUrl: string;
  objectFormat: "sha1" | "sha256";
  attestationCount: number;
  summary: { verified: number; missing: number; mismatched: number };
  /** true only when every attestation reproduces (nothing missing or mismatched). */
  ok: boolean;
  entries: CommitVerdict[];
  verifiedAt: number;
}

/** Cheap: current on-chain attestation count for a project (no clone). */
export async function countAttestations(projectId: number): Promise<number> {
  const id = BigInt(projectId);
  const [owner, , , createdAt] = await publicClient.readContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: "projects",
    args: [id],
  });
  if (owner === "0x0000000000000000000000000000000000000000") {
    throw new Error(`project ${projectId} does not exist`);
  }
  const latest = await publicClient.getBlockNumber();
  const approx = await findBlockByTimestamp(createdAt, latest);
  const fromBlock = approx > 16n ? approx - 16n : 0n;
  const attLogs = await getLogsBisect(attestedEvent, id, fromBlock, latest);
  return attLogs.length;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  }).trim();
}

/**
 * Independently re-verify a project's on-chain attestations against its public
 * repository: clone blobless, recompute each commit's tree, and compare. This is
 * the same check the aletheia-verify CLI performs — run here so the proof page
 * can show verified state without the reader running anything.
 */
export async function verifyProject(projectId: number): Promise<VerifyReport> {
  const id = BigInt(projectId);
  const [owner, , , createdAt] = await publicClient.readContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: "projects",
    args: [id],
  });
  if (owner === "0x0000000000000000000000000000000000000000") {
    throw new Error(`project ${projectId} does not exist`);
  }

  const latest = await publicClient.getBlockNumber();
  const approx = await findBlockByTimestamp(createdAt, latest);
  const fromBlock = approx > 16n ? approx - 16n : 0n;

  const [regLogs, attLogs] = await Promise.all([
    getLogsBisect(registeredEvent, id, fromBlock, latest),
    getLogsBisect(attestedEvent, id, fromBlock, latest),
  ]);

  const repoUrl = (regLogs[0]?.args.repoUrl as string | undefined) ?? "";
  if (!repoUrl) throw new Error(`no ProjectRegistered event found for project ${projectId}`);

  // Clone only over HTTPS from github.com. repoUrl is attacker-controllable (set
  // by whoever registered the project), so cloning it verbatim would be an SSRF
  // vector — a registrant could point the bridge at an internal host. Aletheia
  // is GitHub-only by design, so anything else is rejected outright.
  const cloneUrl = normalizeGithubHttps(repoUrl);
  if (!cloneUrl) {
    throw new Error(`refusing to clone non-github.com repo url: ${repoUrl}`);
  }

  const workdir = mkdtempSync(join(tmpdir(), `aletheia-verify-${projectId}-`));
  try {
    execFileSync("git", ["clone", "--filter=blob:none", "--quiet", cloneUrl, "repo"], {
      cwd: workdir,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 180_000,
    });
    const repoDir = join(workdir, "repo");
    const objectFormat = git(repoDir, "rev-parse", "--show-object-format") as "sha1" | "sha256";

    const entries: CommitVerdict[] = [];
    let verified = 0;
    let missing = 0;
    let mismatched = 0;

    for (const log of attLogs) {
      const commitHash = log.args.commitHash as Hex;
      const treeHash = log.args.treeHash as Hex;
      const attestedAt = Number(log.args.timestamp as bigint);
      const commit = bytes32ToOid(commitHash, objectFormat);
      const attestedTree = bytes32ToOid(treeHash, objectFormat);

      let present = true;
      try {
        git(repoDir, "cat-file", "-e", `${commit}^{commit}`);
      } catch {
        present = false;
      }

      if (!present) {
        missing++;
        entries.push({ commit, attestedTree, actualTree: null, attestedAt, status: "missing" });
        continue;
      }

      const actualTree = git(repoDir, "rev-parse", `${commit}^{tree}`);
      if (actualTree === attestedTree) {
        verified++;
        entries.push({ commit, attestedTree, actualTree, attestedAt, status: "verified" });
      } else {
        mismatched++;
        entries.push({ commit, attestedTree, actualTree, attestedAt, status: "mismatched" });
      }
    }

    return {
      projectId,
      repoUrl,
      objectFormat,
      attestationCount: attLogs.length,
      summary: { verified, missing, mismatched },
      ok: missing === 0 && mismatched === 0,
      entries,
      // seconds — stamped by the caller-facing layer; here for report completeness
      verifiedAt: 0,
    };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}
