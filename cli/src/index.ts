import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPublicClient,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  toBytes,
  type AbiEvent,
  type Hex,
  type PublicClient,
} from "viem";
import { bytes32ToOid, parseArgs, UsageError } from "./parse.js";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const DEFAULT_RPC = "https://testnet-rpc.monad.xyz";

const registryAbi = parseAbi([
  "function projects(uint256 projectId) view returns (address owner, address attestor, bytes32 repoHash, uint64 createdAt, uint64 sealedAt)",
]);
const registeredEvent = parseAbiItem(
  "event ProjectRegistered(uint256 indexed projectId, address indexed owner, address attestor, bytes32 repoHash, string repoUrl, uint64 timestamp)"
);
const attestedEvent = parseAbiItem(
  "event Attested(uint256 indexed projectId, bytes32 indexed commitHash, bytes32 treeHash, uint64 timestamp)"
);


/**
 * Binary-search for the earliest block whose timestamp is >= targetTs. Used to
 * floor event scans at (approximately) the project's registration block instead
 * of genesis — on an RPC that caps eth_getLogs to a small block range, scanning
 * from block 0 would fan out into hundreds of thousands of requests. Costs
 * ~log2(latest) getBlock calls (≈26 for a 45M-block chain).
 */
async function findBlockByTimestamp(
  client: PublicClient,
  targetTs: bigint,
  latest: bigint
): Promise<bigint> {
  let lo = 0n;
  let hi = latest;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    let ts: bigint;
    try {
      ts = (await client.getBlock({ blockNumber: mid })).timestamp;
    } catch {
      // Non-archive RPCs prune old blocks. A missing block is by definition
      // older than anything we're searching for (registrations are queryable),
      // so treat it as "before the target" and search upward.
      lo = mid + 1n;
      continue;
    }
    if (ts < targetTs) lo = mid + 1n;
    else hi = mid;
  }
  return lo;
}

interface EventLog {
  args: Record<string, unknown>;
  blockNumber: bigint | null;
}

/**
 * Fetch logs over [from, to], bisecting on RPC range-limit errors so the CLI
 * works against providers with any block-range cap.
 */
/** Rate-limit errors must back off and retry, never bisect — splitting on a
 * 429 degenerates into thousands of single-block requests that make the
 * throttling strictly worse. */
function isRateLimit(err: unknown): boolean {
  const cause = (err as { cause?: { message?: string; code?: number; status?: number } }).cause;
  const text = `${err instanceof Error ? err.message : String(err)} ${cause?.message ?? ""}`;
  return (
    /rate limit|too many request/i.test(text) ||
    cause?.code === -32005 ||
    cause?.status === 429 ||
    (err as { status?: number }).status === 429
  );
}

async function getLogsBisect(
  client: PublicClient,
  event: AbiEvent,
  projectId: bigint,
  from: bigint,
  to: bigint,
  registry: Hex,
  depth = 0,
  attempt = 0
): Promise<EventLog[]> {
  try {
    const logs = await client.getLogs({
      address: registry,
      event,
      args: { projectId } as never,
      fromBlock: from,
      toBlock: to,
    });
    return logs as unknown as EventLog[];
  } catch (err) {
    if (isRateLimit(err)) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return getLogsBisect(client, event, projectId, from, to, registry, depth, attempt + 1);
    }
    if (depth > 24 || to <= from) throw err;
    // sequential halves: parallel bisection bursts straight into rate limits
    const mid = from + (to - from) / 2n;
    const a = await getLogsBisect(client, event, projectId, from, mid, registry, depth + 1);
    const b = await getLogsBisect(client, event, projectId, mid + 1n, to, registry, depth + 1);
    return [...a, ...b];
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
    // The clone is blobless (promisor): plain object lookups would silently
    // re-fetch force-push-orphaned objects from the server and make a rewritten
    // history look intact. Never fetch during verification.
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
  }).trim();
}

let args;
try {
  args = parseArgs(process.argv.slice(2), {
    rpc: DEFAULT_RPC,
    registry: process.env.ALETHEIA_REGISTRY ?? "",
  });
} catch (err) {
  console.error(err instanceof UsageError ? err.message : String(err));
  process.exit(2);
}
const client = createPublicClient({ transport: http(args.rpc) });

console.log(`${DIM}registry ${args.registry} · rpc ${args.rpc}${RESET}`);

let owner: Hex, repoHashOnChain: Hex, createdAt: bigint, sealedAt: bigint;
try {
  [owner, , repoHashOnChain, createdAt, sealedAt] = await client.readContract({
    address: args.registry,
    abi: registryAbi,
    functionName: "projects",
    args: [args.projectId],
  });
} catch (err) {
  const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
  console.error(`${RED}Could not read registry at ${args.registry}: ${msg}${RESET}`);
  console.error("Check --registry and --rpc point at a deployed AletheiaRegistry.");
  process.exit(2);
}
if (owner === "0x0000000000000000000000000000000000000000") {
  console.error(`${RED}Project ${args.projectId} does not exist on this registry.${RESET}`);
  process.exit(2);
}

const latest = await client.getBlockNumber();
// Floor the scan at (roughly) the registration block. Without this, an RPC that
// caps eth_getLogs to a small range (Monad's public RPC allows 100 blocks) would
// bisect a 45M-block span into hundreds of thousands of requests. --from-block
// overrides; otherwise derive it from the project's on-chain createdAt timestamp.
let fromBlock: bigint;
if (args.fromBlock !== undefined) {
  fromBlock = args.fromBlock;
} else {
  const approx = await findBlockByTimestamp(client, createdAt, latest);
  fromBlock = approx > 16n ? approx - 16n : 0n; // small margin for timestamp skew
}
const regLogs = await getLogsBisect(client, registeredEvent, args.projectId, fromBlock, latest, args.registry);
const attLogs = await getLogsBisect(client, attestedEvent, args.projectId, fromBlock, latest, args.registry);

const reg = regLogs[0]?.args as { repoUrl?: string; repoHash?: Hex } | undefined;
const repoUrl = args.repo ?? reg?.repoUrl;
if (!repoUrl) {
  console.error(`${RED}No repo URL found in ProjectRegistered event; pass --repo <clone-url>.${RESET}`);
  process.exit(2);
}

// The registered URL must actually match the on-chain repoHash — the URL in
// the event is display data; the hash is the commitment.
const canonical = repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "").toLowerCase();
if (keccak256(toBytes(canonical)) !== repoHashOnChain && !args.repo) {
  console.error(`${YELLOW}warning: registered repoUrl does not hash to on-chain repoHash${RESET}`);
}

console.log(
  `project #${args.projectId} · registered ${new Date(Number(createdAt) * 1000).toISOString()}` +
    (sealedAt > 0n ? ` · ${DIM}sealed ${new Date(Number(sealedAt) * 1000).toISOString()}${RESET}` : " · unsealed")
);
console.log(`repo ${repoUrl} · ${attLogs.length} attestation(s)\n`);

if (attLogs.length === 0) {
  console.log("Nothing to verify: no attestations on chain.");
  process.exit(0);
}

const workdir = mkdtempSync(join(tmpdir(), "aletheia-verify-"));
let cloneUrl = repoUrl;
if (!/^(https?|git|ssh):/.test(cloneUrl) && !cloneUrl.startsWith("git@")) cloneUrl = `https://${cloneUrl}`;
console.log(`${DIM}cloning ${cloneUrl} (blobless)…${RESET}`);
try {
  execFileSync("git", ["clone", "--filter=blob:none", "--quiet", cloneUrl, "repo"], {
    cwd: workdir,
    stdio: ["ignore", "inherit", "inherit"],
  });
} catch {
  console.error(`${RED}git clone failed for ${cloneUrl}${RESET}`);
  rmSync(workdir, { recursive: true, force: true });
  process.exit(2);
}
const repoDir = join(workdir, "repo");
const objectFormat = git(repoDir, "rev-parse", "--show-object-format") as "sha1" | "sha256";

// Reachability, not mere existence: GitHub keeps force-push-orphaned objects
// fetchable by hash, and a promisor clone would lazily pull them in — so
// `cat-file -e` alone certifies a rewritten history as intact. An attestation
// only counts if the commit is still reachable from the repo's refs today.
const reachable = new Set(git(repoDir, "rev-list", "--all").split("\n"));

let green = 0;
let yellow = 0;
let red = 0;

for (const log of attLogs) {
  const { commitHash, treeHash, timestamp } = log.args as {
    commitHash: Hex;
    treeHash: Hex;
    timestamp: bigint;
  };
  const commit = bytes32ToOid(commitHash, objectFormat);
  const attestedTree = bytes32ToOid(treeHash, objectFormat);
  const when = new Date(Number(timestamp) * 1000).toISOString();

  if (!reachable.has(commit)) {
    yellow++;
    console.log(`${YELLOW}● MISSING ${RESET} ${commit.slice(0, 12)}  attested ${when}  ${YELLOW}commit absent from repo — history rewritten after attestation${RESET}`);
    continue;
  }

  const actualTree = git(repoDir, "rev-parse", `${commit}^{tree}`);
  if (actualTree === attestedTree) {
    green++;
    console.log(`${GREEN}✓ VERIFIED${RESET} ${commit.slice(0, 12)}  attested ${when}  tree ${actualTree.slice(0, 12)} matches`);
  } else {
    red++;
    console.log(`${RED}✗ MISMATCH${RESET} ${commit.slice(0, 12)}  attested ${when}  ${RED}tree ${actualTree.slice(0, 12)} ≠ attested ${attestedTree.slice(0, 12)} — content substituted${RESET}`);
  }
}

rmSync(workdir, { recursive: true, force: true });

// Any attested commit the repo cannot reproduce — a substituted tree (red) or a
// vanished commit from a rewritten history (yellow) — is a verification failure
// and exits non-zero, so a judge or CI treats a tampered/rewritten repo as a
// fail rather than a pass. An honest repo that never rewrites published history
// stays all-green and exits 0. (A force-push cannot yield red: a commit hash
// binds its tree, so a present commit's tree can never mismatch; the realistic
// rewrite attack surfaces as missing commits, which is why yellow must fail.)
const failed = red > 0 || yellow > 0;
console.log(
  `\n${green} verified · ${yellow} missing · ${red} mismatched — ` +
    (red > 0
      ? `${RED}verification FAILED — content substituted${RESET}`
      : yellow > 0
        ? `${RED}verification FAILED — history rewritten, attested commits missing${RESET}`
        : `${GREEN}verification PASSED${RESET}`)
);
process.exit(failed ? 1 : 0);
