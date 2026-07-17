import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bytes32ToOid,
  canonicalRepoPath,
  repoFullNameFromUrl,
  repoHashFromPath,
} from "../lib/repo";
import { addDays, buildDaySeries, dayOf, daysBetween } from "../lib/time";
import { verdictMap, type VerifyReport } from "../lib/verify";

// ─── repo identity ──────────────────────────────────────────────────────

test("canonicalRepoPath: normalizes URL forms to github.com/owner/repo", () => {
  const want = "github.com/pextacy/aletheia";
  assert.equal(canonicalRepoPath("https://github.com/pextacy/aletheia"), want);
  assert.equal(canonicalRepoPath("github.com/pextacy/aletheia"), want);
  assert.equal(canonicalRepoPath("https://github.com/Pextacy/Aletheia.git"), want);
  assert.equal(canonicalRepoPath("  github.com/pextacy/aletheia/  "), want);
});

test("canonicalRepoPath: rejects non-repo and non-github inputs", () => {
  assert.equal(canonicalRepoPath("not a url"), null);
  assert.equal(canonicalRepoPath("https://gitlab.com/a/b"), null);
  assert.equal(canonicalRepoPath("https://github.com/onlyowner"), null);
});

test("repoHashFromPath: matches the known on-chain repoHash", () => {
  assert.equal(
    repoHashFromPath("github.com/pextacy/aletheia"),
    "0xe4a131b80e2dfb2d9655fa864d4c7537e0e69bb4914f98ec8f2795588540f07a"
  );
});

test("canonicalRepoPath + repoHashFromPath: case-insensitive to the same key", () => {
  const a = repoHashFromPath(canonicalRepoPath("https://github.com/PEXTACY/ALETHEIA")!);
  const b = repoHashFromPath(canonicalRepoPath("github.com/pextacy/aletheia")!);
  assert.equal(a, b);
});

test("repoFullNameFromUrl: extracts owner/repo, stripping .git", () => {
  assert.equal(repoFullNameFromUrl("https://github.com/pextacy/aletheia"), "pextacy/aletheia");
  assert.equal(repoFullNameFromUrl("https://github.com/pextacy/aletheia.git"), "pextacy/aletheia");
  assert.equal(repoFullNameFromUrl("not-a-url"), null);
});

test("bytes32ToOid: SHA-1 (trailing zero pad) truncates to 40 hex", () => {
  assert.equal(
    bytes32ToOid("0x5313dfaf8b6d2e3490986ffe5f06de5560255c5c000000000000000000000000"),
    "5313dfaf8b6d2e3490986ffe5f06de5560255c5c"
  );
});

test("bytes32ToOid: SHA-256 (no trailing zero run) keeps all 64 hex", () => {
  const full = "a".repeat(64);
  assert.equal(bytes32ToOid(`0x${full}`), full);
});

// ─── analytics day series ───────────────────────────────────────────────

test("dayOf / addDays / daysBetween: UTC date math", () => {
  assert.equal(dayOf(0), "1970-01-01");
  assert.equal(addDays("2026-07-17", 1), "2026-07-18");
  assert.equal(addDays("2026-07-31", 1), "2026-08-01");
  assert.equal(daysBetween("2026-07-13", "2026-07-17"), 4);
  assert.equal(daysBetween("2026-07-17", "2026-07-13"), -4);
});

test("buildDaySeries: fills gaps, carries cumulative projects", () => {
  const start = Date.parse("2026-07-13T12:00:00Z") / 1000;
  const end = Date.parse("2026-07-15T12:00:00Z") / 1000;
  const att = new Map([
    ["2026-07-13", 2],
    ["2026-07-15", 5],
  ]);
  const reg = new Map([["2026-07-13", 1], ["2026-07-14", 1]]);
  const s = buildDaySeries(att, reg, start, end);
  assert.equal(s.length, 3);
  assert.deepEqual(
    s.map((p) => [p.day, p.count, p.cumulativeProjects]),
    [
      ["2026-07-13", 2, 1],
      ["2026-07-14", 0, 2], // gap day filled with 0 attestations; cumulative carries
      ["2026-07-15", 5, 2],
    ]
  );
});

test("buildDaySeries: empty when there is no activity", () => {
  assert.deepEqual(buildDaySeries(new Map(), new Map(), null, null), []);
});

// ─── verification verdict map ───────────────────────────────────────────

test("verdictMap: indexes report entries by lowercased commit", () => {
  const report: VerifyReport = {
    projectId: 1,
    repoUrl: "https://github.com/pextacy/aletheia",
    objectFormat: "sha1",
    attestationCount: 2,
    summary: { verified: 1, missing: 0, mismatched: 1 },
    ok: false,
    verifiedAt: 0,
    entries: [
      { commit: "ABCDEF", attestedTree: "t", actualTree: "t", attestedAt: 0, status: "verified" },
      { commit: "123456", attestedTree: "t", actualTree: "x", attestedAt: 0, status: "mismatched" },
    ],
  };
  const m = verdictMap(report);
  assert.equal(m.get("abcdef"), "verified");
  assert.equal(m.get("123456"), "mismatched");
  assert.equal(m.get("nope"), undefined);
});

test("verdictMap: null report yields an empty map", () => {
  assert.equal(verdictMap(null).size, 0);
});
