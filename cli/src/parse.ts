import type { Hex } from "viem";

export interface Args {
  projectId: bigint;
  rpc: string;
  registry: Hex;
  repo?: string;
  fromBlock?: bigint;
}

export interface Defaults {
  rpc: string;
  registry: string;
}

export const USAGE =
  "Usage: aletheia-verify <projectId> [--rpc <url>] [--registry <address>] [--repo <clone-url>] [--from-block <n>]";

/** Thrown on invalid CLI input; the entrypoint prints .message and exits 2. */
export class UsageError extends Error {}

/** bytes32 attestation value → git object id, per the repo's object format. */
export function bytes32ToOid(value: Hex, objectFormat: "sha1" | "sha256"): string {
  const hex = value.slice(2).toLowerCase();
  return objectFormat === "sha1" ? hex.slice(0, 40) : hex;
}

/**
 * Parse argv into typed Args. Pure and side-effect-free: throws UsageError on
 * bad input instead of exiting, so it can be unit-tested and the entrypoint
 * owns process exit.
 */
export function parseArgs(argv: string[], defaults: Defaults): Args {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(USAGE);
      flags.set(a.slice(2), v);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1 || !/^\d+$/.test(positional[0]!)) throw new UsageError(USAGE);

  const registry = flags.get("registry") ?? defaults.registry;
  if (!/^0x[0-9a-fA-F]{40}$/.test(registry)) {
    throw new UsageError(
      "No registry address. Pass --registry <address> or set ALETHEIA_REGISTRY."
    );
  }

  const args: Args = {
    projectId: BigInt(positional[0]!),
    rpc: flags.get("rpc") ?? defaults.rpc,
    registry: registry as Hex,
  };
  const repo = flags.get("repo");
  if (repo !== undefined) args.repo = repo;
  const fromBlock = flags.get("from-block");
  if (fromBlock !== undefined) {
    if (!/^\d+$/.test(fromBlock)) throw new UsageError(USAGE);
    args.fromBlock = BigInt(fromBlock);
  }
  return args;
}
