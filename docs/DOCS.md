# Aletheia — Technical Documentation

Aletheia (ἀλήθεια, "un-concealment") is an on-chain build-provenance system. It anchors every Git push to the Monad blockchain, producing an immutable timeline that proves when a project started, how it evolved, and when it was sealed for submission.

## 1. Why on-chain

Git history is author-controlled. `git commit --date` and `GIT_COMMITTER_DATE` let anyone fabricate a plausible history after the fact, and a force-push rewrites the record silently. A block timestamp, by contrast, is produced by consensus at a moment in time and cannot be retroactively manufactured. Aletheia moves trust from the author to the chain: anyone can verify that a given tree of source code existed no later than a given block.

What Aletheia proves: **existence by time T** (the attested content existed at or before the block timestamp) and **continuity** (the sequence of attestations shows incremental evolution). What it does not prove: authorship or originality. This is stated plainly in the UI and README.

## 2. System architecture

```
GitHub repo ──push──▶ GitHub Webhook ──HTTPS──▶ Bridge (Fastify)
                                                  │ verify HMAC
                                                  │ dedupe delivery ID
                                                  ▼
                                          attest(projectId,
                                            commitHash, treeHash)
                                                  │  (viem, attestor key)
                                                  ▼
                                        AletheiaRegistry (Monad)
                                                  │ events
                          ┌───────────────────────┴─────────────────┐
                          ▼                                         ▼
                 Web proof page (/p/[id])                 aletheia-verify CLI
                 chain events + GitHub API                clone → recompute →
                 timeline render                          compare → report
```

An alternative trust-minimized ingestion path exists alongside the bridge: a GitHub Action (`.github/workflows/aletheia.yml`) that lets a project attest its own pushes with its own key, so no one has to trust Aletheia's server. Both paths write to the same contract with the same semantics.

## 3. Smart contract — `AletheiaRegistry.sol`

Single contract, event-sourced. Commit data is emitted as events, not written to storage: events are dramatically cheaper, and all consumers (web, CLI) read via `eth_getLogs`. Storage holds only per-project control state.

### 3.1 Storage

```solidity
struct Project {
    address owner;      // registrant; controls attestor, links, seal
    address attestor;   // hot key allowed to attest (may equal owner)
    bytes32 repoHash;   // keccak256(lowercase "github.com/{owner}/{repo}")
    uint64  createdAt;  // block.timestamp at registration
    uint64  sealedAt;   // 0 while unsealed
}

mapping(uint256 => Project) public projects;   // projectId => Project
mapping(bytes32 => uint256) public projectByRepo; // repoHash => projectId (1-based)
uint256 public projectCount;
```

### 3.2 Functions

```solidity
function registerProject(bytes32 repoHash, string calldata repoUrl, address attestor)
    external returns (uint256 projectId);
```
Reverts if `repoHash` is already registered (`RepoAlreadyRegistered`). Emits `ProjectRegistered(projectId, msg.sender, attestor, repoHash, repoUrl, block.timestamp)`. `repoUrl` travels only in the event for indexing/display.

```solidity
function attest(uint256 projectId, bytes32 commitHash, bytes32 treeHash) external;
function attestBatch(uint256 projectId, bytes32[] calldata commitHashes, bytes32[] calldata treeHashes) external;
```
Caller must be the project's attestor (`NotAttestor`); project must be unsealed (`ProjectSealed`); array lengths must match and be non-empty (`BadInput`). Emits one `Attested(projectId, commitHash, treeHash, block.timestamp)` per commit. Note: Git object IDs are SHA-1 (20 bytes); they are left-aligned and zero-padded into `bytes32`. The repo may also be SHA-256 (Git's newer object format), which fills all 32 bytes — both encodings are supported and the CLI detects which one the repo uses.

```solidity
function linkContract(uint256 projectId, address deployed, string calldata label) external;
```
Owner-only, unsealed-only. Emits `ContractLinked(projectId, deployed, label, block.timestamp)`. Used to bind deployed application contracts to the build timeline.

```solidity
function setAttestor(uint256 projectId, address newAttestor) external;
```
Owner-only, unsealed-only. Emits `AttestorChanged(projectId, newAttestor)`. Enables key rotation if the bridge key is compromised.

```solidity
function seal(uint256 projectId) external;
```
Owner-only, idempotence guarded (`ProjectSealed` if already sealed). Sets `sealedAt = block.timestamp`, emits `Sealed(projectId, block.timestamp)`. After sealing, every state-changing call for the project reverts permanently. Sealing at submission time proves the record was closed before judging.

### 3.3 Errors and events (complete list)

Errors: `RepoAlreadyRegistered()`, `UnknownProject()`, `NotOwner()`, `NotAttestor()`, `ProjectSealed()`, `BadInput()`.

Events: `ProjectRegistered(uint256 indexed projectId, address indexed owner, address attestor, bytes32 repoHash, string repoUrl, uint64 timestamp)`, `Attested(uint256 indexed projectId, bytes32 indexed commitHash, bytes32 treeHash, uint64 timestamp)`, `ContractLinked(uint256 indexed projectId, address indexed deployed, string label, uint64 timestamp)`, `AttestorChanged(uint256 indexed projectId, address newAttestor)`, `Sealed(uint256 indexed projectId, uint64 timestamp)`.

### 3.4 Why treeHash matters (threat model core)

Attesting only commit hashes admits a cheat: push empty or junk commits on time, then later force-push real content and claim the old hashes. The commit hash does commit to content, but verifying it requires the original objects, which a force-push can vanish. Aletheia therefore attests the **tree hash** alongside the commit hash. Verification recomputes both from the public repo (`git rev-parse <commit>^{tree}`); if the repo's current objects don't reproduce the attested pair, verification fails visibly. A cheater would need a pre-image of the attested tree hash matching their later-written code — computationally infeasible.

### 3.5 Testing requirements

Foundry tests must cover: registration uniqueness; attestor-only attestation; owner-only admin functions; batch length mismatch; sealing blocks every mutating path; attestor rotation; event emission (via `vm.expectEmit`); fuzz test on batch sizes. Target: every revert path exercised.

## 4. Bridge service

Fastify server, three routes:

- `POST /webhook/github` — the core. Pipeline: (1) verify `X-Hub-Signature-256` HMAC over the **raw** body using `GITHUB_WEBHOOK_SECRET`, constant-time compare; (2) accept only `push` events (`X-GitHub-Event`), 204 for `ping`; (3) check `X-GitHub-Delivery` against the Postgres `deliveries` table — replay ⇒ 200 with `{"status":"duplicate"}` and no chain write; (4) resolve repository full name → `repoHash` → `projectId` via `projectByRepo`; unknown repo ⇒ 422; (5) for each commit in `payload.commits` (plus `head_commit` if the list is truncated by GitHub's 20-commit cap, in which case fetch the full range via the Compare API), fetch tree SHA from GitHub API, enqueue; (6) submit as `attest` (single) or `attestBatch` (multiple) through the transaction queue; (7) record delivery ID and tx hash in Postgres; respond 200 with `{txHash}`.
- `GET /healthz` — liveness: checks RPC block number and attestor balance; warns below 0.5 MON.
- `GET /status/:projectId` — recent attestation submissions for that project from the local DB (operational visibility; the chain remains the source of truth).
- `GET /verify/:projectId` — independent verification, run server-side: reads the project's `ProjectRegistered` + `Attested` events, clones the repo blobless, recomputes every commit and tree hash, and diffs them against the chain — the same check the CLI performs. Returns a per-commit verdict array (`verified` / `missing` / `mismatched`) plus a summary and an `ok` flag. Cached in Postgres keyed by attestation count (re-clones only when new attestations arrive, or after a max age), with concurrent requests sharing one in-flight verification. The web proof page consumes this to show live verified state; if the bridge is unavailable the page degrades to chain-only "on-chain" badges. Requires `git` in the runtime image.

Transaction queue: a single serialized worker per attestor key. It fetches the pending nonce once at startup, increments locally, and on `nonce too low`/`replacement underpriced` errors re-syncs from the RPC and retries once. Failures after retry are logged with full context and the delivery is marked `failed` so `/status` exposes it — silent loss is unacceptable.

Force-push handling: a push with `forced: true` is still attested (the new head is real content at a real time), but the bridge writes a `forced` flag into its DB and the web timeline renders a visible "history rewritten here" marker. Honesty includes showing rewrites.

## 5. Web app

Next.js App Router, three routes:

- `/` — landing: one-paragraph pitch, the register flow (connect wallet → enter repo URL → `registerProject` → shown the webhook URL + secret to paste into GitHub repo settings), and a live list of recently registered projects from `ProjectRegistered` logs.
- `/p/[projectId]` — the proof page, the product's face. Server component fetches all events for the project via `eth_getLogs` (chunked block ranges), merges with GitHub commit metadata (message, author) fetched server-side with `GITHUB_TOKEN`, and renders: summary strip (first seal time, offset from hackathon start `2026-07-13T13:00:00Z`, attestation count, linked contracts, sealed status); vertical column timeline where each entry shows commit message, short hash, chain timestamp, explorer link, and a verification badge; linked-contract entries inline in chronological position; a copyable `npx aletheia-verify <id>` block. If GitHub metadata is unavailable the page still renders fully from chain data alone — chain first, GitHub garnish.
- `/api/og/[projectId]` — dynamic Open Graph image (project name, seal count, first-seal date) so shared links carry the proof visually.

Frontend design language ("Cyber-Sovereign"): obsidian-purple base (`#0f0a1a` / surface `#161121`), electric-fuchsia primary (`#ff0df5` / `#ffabef`) and cyan verification accent (`#00eefc` / `#d3fbff`); Geist for display, body, and mono; Material Symbols iconography; frosted glass panels over the obsidian with neon "bloom" glows for depth (no drop shadows). The proof timeline is a zig-zag: a central gradient rail with glowing nodes — cyan for registration/links, fuchsia for commits, red for force-push rewrites, and a strong-bloom fuchsia lock for the sealed state — and cards alternating left/right. A terminal panel shows the real `npx aletheia-verify <id>` command. Fully responsive, no horizontal scroll at 360 px, reduced-motion respected.

## 6. Verification CLI — `aletheia-verify`

`npx aletheia-verify <projectId> [--rpc <url>] [--registry <address>] [--repo <clone-url>]`

Steps: read `ProjectRegistered` + all `Attested` events; shallow-clone the repo with full history (`--filter=blob:none` for speed, objects fetched on demand); for each attested pair, run `git cat-file -e <commit>` and `git rev-parse <commit>^{tree}`; compare against chain values; print a table — green check (commit present, tree matches), yellow (commit missing — history rewritten after attestation), red (tree mismatch — content substitution) — and exit non-zero if any attestation is not green. Both red and yellow fail: a commit hash cryptographically binds its tree, so a *present* commit can never show a tree mismatch — the realistic force-push-and-rewrite attack surfaces as *missing* attested commits (yellow), and a tool that passed those would let a rewritten repo look clean to a judge. Red covers the residual case of an attestation whose recorded tree never matched its commit. An honest repo that never rewrites published history stays all-green and exits 0. The CLI depends only on Node ≥ 20 and a system `git`; it performs no writes and needs no keys. This is the tool a judge (human or agent) runs to independently confirm the record.

## 7. Deployment

- Contract: `forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify` to Monad testnet (chain ID 10143); verified source on the explorer is mandatory. The deploy script asserts the chain ID before broadcasting and writes the deployed address to `deployments/10143.json`, which bridge and web read at build time.
- Bridge: Railway, single service; all state (deliveries, submissions, webhook secrets, verification cache) in Neon Postgres via `DATABASE_URL`. Attestor wallet funded from the Monad faucet; `/healthz` monitors balance.
- Web: Vercel. All RPC calls server-side; the browser receives rendered HTML plus explorer links only.
- Dogfooding: this repository registers itself as project #1 immediately after deployment. The proof page of Aletheia's own build is the primary demo artifact.

## 8. Threat model summary

Covered: forged commit dates (chain timestamp wins); post-hoc history rewrite (missing commits flagged by CLI); content substitution (tree hash mismatch); junk-commit-then-replace (tree hash pre-image infeasibility); post-submission additions (seal); bridge key theft (attestor key is low-privilege and rotatable; worst case is spurious attestations, which sealing and the CLI's tree check expose, never fund loss); webhook forgery (HMAC); replay (delivery-ID dedupe).

Explicitly out of scope, stated honestly in the README: proving authorship (someone can attest code they copied — Aletheia proves timing, not originality); pre-writing code before registering (mitigated socially: the interesting signal is the *shape* of the timeline during the event, which judges can read); GitHub itself lying about tree contents to the bridge (defeated by independent CLI recomputation from a raw clone).
