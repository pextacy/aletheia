import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, toBytes } from "viem";
import { computeSignature, verifySignature } from "../src/hmac.ts";
import { normalizeGithubHttps } from "../src/repoUrl.ts";

// gitOidToBytes32/bytes32ToOid/repoHashOf live in chain.ts, which reads env at
// import time; re-implement the pure conversions here to test the exact logic
// without booting the chain client. Kept byte-identical to chain.ts on purpose.
function gitOidToBytes32(oid: string): string {
  const clean = oid.toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(clean) && !/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`Not a valid git object id: ${oid}`);
  }
  return `0x${clean.padEnd(64, "0")}`;
}
function bytes32ToOid(value: string, fmt: "sha1" | "sha256"): string {
  const hex = value.slice(2).toLowerCase();
  return fmt === "sha1" ? hex.slice(0, 40) : hex;
}
function repoHashOf(fullName: string): string {
  return keccak256(toBytes(`github.com/${fullName.toLowerCase()}`));
}

test("HMAC: a correct signature verifies", () => {
  const body = Buffer.from(JSON.stringify({ zen: "keep it logically awesome" }));
  const sig = computeSignature(body, "s3cret");
  assert.equal(verifySignature(body, sig, "s3cret"), true);
});

test("HMAC: wrong secret fails", () => {
  const body = Buffer.from("payload");
  const sig = computeSignature(body, "right");
  assert.equal(verifySignature(body, sig, "wrong"), false);
});

test("HMAC: tampered body fails", () => {
  const sig = computeSignature(Buffer.from("original"), "k");
  assert.equal(verifySignature(Buffer.from("tampered"), sig, "k"), false);
});

test("HMAC: malformed / missing header returns false without throwing", () => {
  const body = Buffer.from("x");
  assert.equal(verifySignature(body, undefined, "k"), false);
  assert.equal(verifySignature(body, "not-a-sig", "k"), false);
  assert.equal(verifySignature(body, "sha256=zzzz", "k"), false); // invalid hex
  assert.equal(verifySignature(body, "sha256=", "k"), false);
});

test("gitOidToBytes32: SHA-1 is left-aligned, zero-padded to 32 bytes", () => {
  const sha1 = "5313dfaf8b6d2e3490986ffe5f06de5560255c5c";
  assert.equal(
    gitOidToBytes32(sha1),
    "0x5313dfaf8b6d2e3490986ffe5f06de5560255c5c000000000000000000000000"
  );
});

test("gitOidToBytes32: SHA-256 fills all 32 bytes", () => {
  const sha256 = "a".repeat(64);
  assert.equal(gitOidToBytes32(sha256), `0x${"a".repeat(64)}`);
});

test("gitOidToBytes32: rejects invalid object ids", () => {
  assert.throws(() => gitOidToBytes32("xyz"));
  assert.throws(() => gitOidToBytes32("abc123")); // wrong length
});

test("bytes32ToOid: round-trips SHA-1 through padding", () => {
  const sha1 = "5313dfaf8b6d2e3490986ffe5f06de5560255c5c";
  assert.equal(bytes32ToOid(gitOidToBytes32(sha1), "sha1"), sha1);
});

test("bytes32ToOid: SHA-256 keeps all 64 hex chars", () => {
  const sha256 = "b".repeat(64);
  assert.equal(bytes32ToOid(gitOidToBytes32(sha256), "sha256"), sha256);
});

test("repoHashOf: canonical path matches the known on-chain key", () => {
  // keccak256("github.com/pextacy/aletheia") — the registered repoHash.
  assert.equal(
    repoHashOf("pextacy/aletheia"),
    "0xe4a131b80e2dfb2d9655fa864d4c7537e0e69bb4914f98ec8f2795588540f07a"
  );
});

test("repoHashOf: is case-insensitive on the repo path", () => {
  assert.equal(repoHashOf("Pextacy/Aletheia"), repoHashOf("pextacy/aletheia"));
});

test("normalizeGithubHttps: accepts github.com repos and strips .git/scheme/www", () => {
  const want = "https://github.com/pextacy/aletheia";
  assert.equal(normalizeGithubHttps("https://github.com/pextacy/aletheia"), want);
  assert.equal(normalizeGithubHttps("github.com/pextacy/aletheia"), want);
  assert.equal(normalizeGithubHttps("http://www.github.com/pextacy/aletheia.git"), want);
  assert.equal(normalizeGithubHttps("https://github.com/pextacy/aletheia/"), want);
});

test("normalizeGithubHttps: rejects non-github hosts (SSRF guard)", () => {
  assert.equal(normalizeGithubHttps("http://169.254.169.254/latest/meta-data"), null);
  assert.equal(normalizeGithubHttps("https://gitlab.com/a/b"), null);
  assert.equal(normalizeGithubHttps("https://evil.com/x/y"), null);
  assert.equal(normalizeGithubHttps("file:///etc/passwd"), null);
  assert.equal(normalizeGithubHttps("git@github.com:a/b.git"), null);
  assert.equal(normalizeGithubHttps("https://github.com.evil.com/a/b"), null);
});
