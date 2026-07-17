import { keccak256, toBytes } from "viem";

// Pure repo-identity helpers with no chain or DB dependency, so both the RPC
// indexer and the Neon reader can share them without an import cycle.

/** bytes32 → git object id: SHA-1 ids are the first 20 bytes, zero-padded. */
export function bytes32ToOid(value: string): string {
  const hex = value.slice(2).toLowerCase();
  return hex.endsWith("000000000000000000000000") ? hex.slice(0, 40) : hex;
}

/**
 * Reduce any GitHub URL to the canonical `github.com/owner/repo` path the
 * registry hashes. Must stay byte-identical to RegisterFlow's canonicalizer —
 * the repoHash is keccak256 over this exact string. Returns null when the input
 * isn't a recognizable GitHub repo URL.
 */
export function canonicalRepoPath(url: string): string | null {
  const m = url
    .trim()
    .match(/^(?:https?:\/\/)?(github\.com\/[^/]+\/[^/#?]+?)(?:\.git)?\/?$/i);
  return m ? m[1]!.toLowerCase() : null;
}

/** keccak256 of the canonical repo path — the on-chain repoHash key. */
export function repoHashFromPath(path: string): `0x${string}` {
  return keccak256(toBytes(path));
}

/** github.com/owner/repo from a full URL, or null. Display/full-name form. */
export function repoFullNameFromUrl(url: string): string | null {
  const m = url.match(/github\.com\/([^/]+\/[^/#?]+)/i);
  return m ? m[1]!.replace(/\.git$/, "") : null;
}
