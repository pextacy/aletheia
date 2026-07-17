import assert from "node:assert/strict";
import { test } from "node:test";
import { bytes32ToOid, parseArgs, UsageError } from "../src/parse.ts";

const DEFAULTS = { rpc: "https://rpc.example", registry: "" };
const REG = "0x00000000000000000000000000000000000000aa";

test("parseArgs: minimal — projectId with a registry flag", () => {
  const a = parseArgs(["1", "--registry", REG], DEFAULTS);
  assert.equal(a.projectId, 1n);
  assert.equal(a.registry, REG);
  assert.equal(a.rpc, "https://rpc.example");
  assert.equal(a.repo, undefined);
  assert.equal(a.fromBlock, undefined);
});

test("parseArgs: flags override defaults; repo and from-block parsed", () => {
  const a = parseArgs(
    ["7", "--registry", REG, "--rpc", "https://x", "--repo", "github.com/a/b", "--from-block", "100"],
    DEFAULTS
  );
  assert.equal(a.projectId, 7n);
  assert.equal(a.rpc, "https://x");
  assert.equal(a.repo, "github.com/a/b");
  assert.equal(a.fromBlock, 100n);
});

test("parseArgs: registry defaults from Defaults when flag absent", () => {
  const a = parseArgs(["1"], { rpc: "r", registry: REG });
  assert.equal(a.registry, REG);
});

test("parseArgs: throws UsageError on missing/invalid project id", () => {
  assert.throws(() => parseArgs([], DEFAULTS), UsageError);
  assert.throws(() => parseArgs(["abc", "--registry", REG], DEFAULTS), UsageError);
  assert.throws(() => parseArgs(["1", "2", "--registry", REG], DEFAULTS), UsageError);
});

test("parseArgs: throws when no registry is available", () => {
  assert.throws(() => parseArgs(["1"], DEFAULTS), UsageError);
  assert.throws(() => parseArgs(["1", "--registry", "0xnothex"], DEFAULTS), UsageError);
});

test("parseArgs: throws on a dangling flag or bad from-block", () => {
  assert.throws(() => parseArgs(["1", "--registry"], DEFAULTS), UsageError);
  assert.throws(() => parseArgs(["1", "--registry", REG, "--from-block", "x"], DEFAULTS), UsageError);
});

test("bytes32ToOid: SHA-1 truncates to 40 hex, SHA-256 keeps 64", () => {
  const sha1 = "0x5313dfaf8b6d2e3490986ffe5f06de5560255c5c000000000000000000000000" as const;
  assert.equal(bytes32ToOid(sha1, "sha1"), "5313dfaf8b6d2e3490986ffe5f06de5560255c5c");
  const sha256 = `0x${"a".repeat(64)}` as const;
  assert.equal(bytes32ToOid(sha256, "sha256"), "a".repeat(64));
});
