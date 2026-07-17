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
  ok: boolean;
  entries: CommitVerdict[];
  verifiedAt: number;
}

/**
 * Live independent-verification report from the bridge, which clones the repo
 * and recomputes every hash. Operational garnish: if the bridge is unset or
 * unreachable, the proof page still renders fully from chain data — it just
 * shows "on-chain" badges instead of "verified" ones. Never throws.
 */
export async function fetchVerification(projectId: number): Promise<VerifyReport | null> {
  const bridgeUrl = process.env.NEXT_PUBLIC_BRIDGE_URL;
  if (!bridgeUrl) return null;
  try {
    const res = await fetch(`${bridgeUrl}/verify/${projectId}`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as VerifyReport;
    if (!Array.isArray(data.entries)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Index verdicts by commit oid for O(1) lookup while rendering the timeline. */
export function verdictMap(report: VerifyReport | null): Map<string, Verdict> {
  const m = new Map<string, Verdict>();
  if (report) for (const e of report.entries) m.set(e.commit.toLowerCase(), e.status);
  return m;
}
