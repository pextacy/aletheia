# Phases — Aletheia

Working checklist for the Spark build window, derived from [PLAN.md](PLAN.md) (schedule and gates), [PRD.md](PRD.md) (requirements F1–F8), and [DOCS.md](DOCS.md) (technical spec). PLAN.md is the authority on ordering and cut rules; this file tracks execution state at task granularity.

**Window:** 2026-07-17 → 2026-07-19 20:00 UTC (internal target; hard deadline 23:59 UTC).
**Rule:** a phase starts only when the previous gate passes. Check items off as they complete; a gate is a checklist too — all boxes or no entry.

Status legend: `[ ]` not started · `[x]` done · strike-through = cut (record why in the Notes line of the phase).

---

## Phase 0 — Foundation

**Window:** Jul 17, ~2 h · **Depends on:** nothing

### Tasks

- [x] Monorepo skeleton: `contracts/`, `bridge/`, `web/`, `cli/`
- [x] Root `README.md` skeleton with the one-paragraph thesis
- [x] `.gitignore` (incl. `.env`, `aletheia.sqlite`, build outputs)
- [x] `.env.example` — every variable from CLAUDE.md §Chain configuration, each with a descriptive comment and an obviously-invalid example value
- [x] MIT `LICENSE`
- [x] Create **owner wallet** and **attestor wallet** (separate keys; attestor is low-privilege hot key)
- [ ] Fund both from the Monad testnet faucet with generous margin
- [x] Record wallet **addresses** (never keys) in `.env.example` comments
- [x] First commit and push to a public GitHub repo — small, atomic commits from here on; the log is part of the product

### Gate 0

- [x] Repo public on GitHub — https://github.com/pextacy/aletheia
- [ ] Both wallets funded (balance verified on explorer)
- [x] `forge --version` and `node --version` run clean in the working environment

Notes: forge 1.5.1-stable, node v25.2.1, git 2.52.0. Owner `0xA6b1F84D2fDF9DF0EB4CbA290ADF7e541e16fc04`, attestor `0x89da9812e7F12538119cc58E35bFc62270dDDcFD` — keys in local `.env` only. Faucet is captcha-gated, so funding is a manual browser step.

---

## Phase 1 — Contract

**Window:** Jul 17, ~4 h · **Depends on:** Gate 0 · **Covers:** F1 (chain side), F4, F5 groundwork

### Tasks

- [x] `AletheiaRegistry.sol` per DOCS.md §3:
  - [x] Storage: `Project` struct, `projects`, `projectByRepo`, `projectCount`
  - [x] Errors (6): `RepoAlreadyRegistered`, `UnknownProject`, `NotOwner`, `NotAttestor`, `ProjectSealed`, `BadInput`
  - [x] Events (5): `ProjectRegistered`, `Attested`, `ContractLinked`, `AttestorChanged`, `Sealed`
  - [x] Functions: `registerProject`, `attest`, `attestBatch`, `linkContract`, `setAttestor`, `seal`
  - [x] SHA-1 (left-aligned, zero-padded) and SHA-256 hash encodings both accepted as `bytes32`
- [x] Foundry test suite per DOCS.md §3.5 (30 tests, all green):
  - [x] Registration uniqueness (`RepoAlreadyRegistered`)
  - [x] Attestor-only `attest`/`attestBatch`; owner-only `linkContract`/`setAttestor`/`seal`
  - [x] Batch length mismatch and empty-array reverts (`BadInput`)
  - [x] Seal blocks **every** mutating path (explicit test per function)
  - [x] Attestor rotation
  - [x] Event assertions via `vm.expectEmit` for all five events
  - [x] Fuzz test on batch sizes
  - [x] Full lifecycle: register → attest ×N → link → seal → all mutations revert
- [x] `script/Deploy.s.sol` with chain-ID assertion (`10143`)
- [ ] Deploy to Monad testnet; verify source on explorer
- [ ] Write `deployments/10143.json` (read by bridge and web at build time)
- [ ] **Dogfooding start (F8):** register this repo as project #1 via `cast send` (command documented in README ✓) and submit a manual attestation of current HEAD (commit + tree hash) with the attestor key

### Gate 1

- [ ] `forge test` all green, every revert path exercised
- [ ] Contract source verified on the explorer
- [ ] Project #1 registered with ≥1 `Attested` event visible in explorer logs

Notes:

---

## Phase 2 — Bridge

**Window:** Jul 17 evening → Jul 18 morning, ~5 h · **Depends on:** Gate 1 · **Covers:** F2

### Tasks

- [x] Fastify app with raw-body capture (content-type parser preserves bytes for HMAC)
- [x] `POST /webhook/github` pipeline per DOCS.md §4:
  - [x] Constant-time HMAC verification of `X-Hub-Signature-256`; bad signature ⇒ 401, never 200
  - [x] Event filtering: only `push`; `ping` ⇒ 204; unknown repo ⇒ 422
  - [x] Idempotency on `X-GitHub-Delivery` via SQLite `deliveries` table; replay ⇒ 200 `{"status":"duplicate"}`, no chain write
  - [x] Commit pipeline: payload commits → GitHub API tree SHA fetch → `attest`/`attestBatch`
  - [x] >20-commit truncation handled via Compare API
  - [x] `forced: true` flag persisted for timeline markers
- [x] SQLite persistence: `deliveries` + `submissions` + `webhook_secrets` tables, survives restarts
- [x] Serialized transaction queue: local nonce management, one re-sync retry on nonce errors, failures persisted (never silently lost)
- [x] `GET /status/:projectId` — recent submissions incl. failure states
- [x] `GET /healthz` — RPC block number + attestor balance, warn below 0.5 MON
- [x] Per-project webhook secrets bound by EIP-191 owner signature (`POST /webhook/register-secret`)
- [ ] Deploy to Railway with persistent volume for `aletheia.sqlite` *(deferred: chain steps batched to the end per user)*
- [ ] Configure the real GitHub webhook on this repo *(deferred)*
- [ ] End-to-end test: local commit → push → `Attested` event on explorer *(deferred)*

### Gate 2

- [ ] Single-commit push ⇒ exactly 1 `Attested` event, <30 s
- [ ] Multi-commit push ⇒ exactly N events via `attestBatch`, <30 s
- [ ] Replayed delivery ⇒ zero duplicate events
- [ ] From here on, every push to this repo self-attests automatically

Notes: full pipeline validated against a local chain with simulated GitHub webhooks (dev check — the gate itself runs on live Monad after deploy): 2-commit push → `attestBatch` → exactly 2 `Attested` events; replayed delivery → `{"status":"duplicate"}`, no extra events; bad HMAC → 401; `ping` → 204; unregistered repo → 422; per-project secret binding accepted with owner signature and rejected with a wrong one; after binding, the old global secret is refused (401) and the new secret attests; `forced: true` persisted and exposed via `/status`.

---

## Phase 3 — Proof page and landing

**Window:** Jul 18, full day · **Depends on:** Gate 2 · **Covers:** F1 (UI side), F6

### Tasks

- [x] Event indexer in `web/`: bisecting `eth_getLogs` (adapts to any RPC range cap, floors at deploy block) for all five event types, merged into a typed project model
- [x] Server-side GitHub metadata enrichment with graceful degradation — chain-only render complete by construction (every GitHub fetch failure degrades silently)
- [x] `/p/[projectId]`:
  - [x] Summary strip: first-attestation time, offset from hackathon start `2026-07-13T13:00:00Z`, counts, sealed state
  - [x] Vertical column timeline with per-entry explorer links and verification badges
  - [x] Force-push "history rewritten here" markers (bridge `/status` enrichment, degrades gracefully)
  - [x] Linked contracts inline in chronological position
  - [x] Copyable `npx aletheia-verify <id>` block
  - [ ] Responsive check at 360 px against live data *(code uses mobile-first layout; visual pass pending live deploy)*
- [x] Design identity pass per DOCS.md §5: parchment `#faf6ee` / ink `#1c1a17` / oxblood `#7a2e2e`, Cormorant + Inter, seal iconography, wax-seal treatment when sealed
- [x] Landing page: thesis paragraph, register flow (wallet connect → repo URL → `registerProject` → webhook instructions with copy buttons + per-project secret), recent-projects list from `ProjectRegistered` logs
- [x] Clear on-page error for duplicate repo registration (`RepoAlreadyRegistered` surfaced — F1 acceptance)
- [x] `/api/og/[projectId]` dynamic Open Graph image
- [ ] Deploy to Vercel; all RPC server-side *(deferred: chain steps batched to the end per user; note — public Monad RPC caps `eth_getLogs` at 100 blocks, so production `RPC_URL` should be an Alchemy/QuickNode endpoint)*

### Gate 3

- [ ] A stranger with only the Vercel URL can register a test repo and see their push on their proof page, unassisted
- [ ] Project #1's page matches the explorer, link by link
- [ ] Page renders fully with GitHub API disabled

Notes: proof page and landing rendered against the local validation chain (dev check): `/p/1` returns 200 with the full timeline — attested commits with real GitHub commit messages (tokenless enrichment), on-chain badges, the bridge-sourced "history rewritten here" force-push marker, and the copyable verify command; `/` renders the register flow and recent-projects list from `ProjectRegistered` logs.

---

## Phase 4 — Verification CLI + trustless Action

**Window:** Jul 18 evening → Jul 19 morning, ~4 h · **Depends on:** Gate 3 · **Covers:** F3, F7

### Tasks

- [x] `cli/` — `aletheia-verify <projectId> [--rpc] [--registry] [--repo]` per DOCS.md §6:
  - [x] Fetch `ProjectRegistered` + all `Attested` events
  - [x] Blobless clone (`--filter=blob:none`), full history
  - [x] Per-commit `git cat-file -e` + `git rev-parse <commit>^{tree}` recomputation
  - [x] Verdict table: green (match) / yellow (commit missing — rewritten) / red (tree mismatch — substitution)
  - [x] Non-zero exit on any red; no writes, no keys; deps only Node ≥ 20 + system git
  - [x] SHA-1 and SHA-256 repo formats auto-detected
- [ ] Negative-path proof: scratch repo → attest → force-push rewritten history → run CLI → capture red-verdict screenshot for README *(scripted in `scripts/negative-path-proof.sh`; run needs deployed registry)*
- [ ] Publish `aletheia-verify` to npm; confirm cold `npx` run works *(package publish-ready — README, files allowlist, `npm pack` clean; needs `npm login`)*
- [x] GitHub Action `aletheia.yml` written (skips gracefully without secrets) — [ ] green run on a scratch repo *(deferred: needs deployed registry)*

Notes: CLI validated end-to-end against a local chain (dev check, not a gate claim): 2 real commits verified green, a wrong-tree attestation flagged red MISMATCH, an absent commit flagged MISSING, exit 1 whenever any attestation is not green. Gate 4 itself runs against live Monad testnet after deploy. `scripts/chain-setup.sh` collapses deploy → verify → register → attest → link into one idempotent run once wallets are funded.

Self-review (agents hit the session limit; done inline) — 3 real bugs found and fixed, each verified on a local chain:
1. CLI exited 0 on a rewritten repo (missing attested commits = yellow). A commit hash binds its tree, so a force-push can only ever produce missing commits, never a tree mismatch — so the tool would have passed a cheater's rewritten repo. Now any non-green attestation exits non-zero; this also makes `negative-path-proof.sh` (force-push → non-zero) actually valid. (cli, DOCS §6)
2. Bridge kept a failed delivery's ID recorded, so GitHub's redelivery was rejected as a duplicate and the commits were silently dropped — against the fail-loudly rule. Failed submissions now release the delivery ID for retry. (bridge)
3. CLI scanned events from block 0; on Monad's 100-block getLogs cap that fans out into ~500k requests and hangs. Now floors the scan at the registration block via on-chain-timestamp binary search, overridable with `--from-block`. (cli)

### Gate 4

- [ ] `npx aletheia-verify 1` from a clean machine returns all green
- [ ] The rigged repo returns red with non-zero exit

Notes:

---

## Phase 5 — Package and ship

**Window:** Jul 19, hard stop 20:00 UTC · **Depends on:** Gate 4 · **Covers:** F8, PRD §7–8

### Tasks

- [ ] **README final pass (morning):** thesis, architecture diagram, threat model incl. honest out-of-scope list, 3-minute quickstart, verify instructions, roadmap absorbing all cut ideas, screenshots
- [ ] **Judging-agent mapping table** in README: each published agent check (start time, placeholder data, suspicious commits) paired with the Aletheia artifact that answers it
- [ ] **Demo video (midday, ≤3 min, one unbroken recording):**
  - [ ] The asymmetry problem (20 s)
  - [ ] Live commit → push → on-chain seal → timeline update (90 s)
  - [ ] Reveal: the page on screen is Aletheia's own proof page (40 s)
  - [ ] On-camera `seal(1)` transaction (10 s)
  - [ ] Uploaded; public visibility confirmed in an incognito window
- [ ] **Social post:** innocence-proof angle, proof-page link with OG image, posted and pinned; link dropped in Spark Discord with an invite to register (feeds F7/third-party criterion)
- [ ] **Recruit ≥1 external project** from Discord onto the platform; assist live if needed
- [ ] **Submission form by 20:00 UTC:** all fields per PRD §8; every URL opened from a logged-out browser first
- [ ] Post-submission: monitor `/healthz` and Discord; hotfix availability only, nothing cosmetic

### Gate 5 (final)

- [ ] Submission confirmed on the platform
- [ ] Demo video public
- [ ] Project #1 proof page sealed
- [ ] CLI verifies project #1 green
- [ ] Social post live

Notes:

---

## Standing rules (apply at every phase)

- **Buffer discipline:** if a phase overruns by more than 2 h, cut from that phase's tail — never from README/video/submission time. Cut order within web: OG image → recent-projects list → landing polish. The proof page and CLI are never cut.
- **Attestor balance** checked at every gate.
- **Every gate check runs against live Monad testnet**, never a local anvil node.
- **No mock data, no stubs, no TODOs** (CLAUDE.md hard rules); a feature that can't be finished properly is left out and said so.
- New ideas go to the README roadmap as text, never into code.

## Requirement coverage map

| Requirement | Phase | Gate proving it |
|---|---|---|
| F1 — Registration | 1 (chain), 3 (UI) | Gate 3 |
| F2 — Bridge attestation | 2 | Gate 2 |
| F3 — GitHub Action path | 4 | Gate 4 |
| F4 — Contract linking | 1, 3 | Gate 3 |
| F5 — Sealing | 1, 5 | Gates 1, 5 |
| F6 — Proof page | 3 | Gate 3 |
| F7 — Verification CLI | 4 | Gate 4 |
| F8 — Dogfooding | 1 → 5 | Gates 1, 5 |
