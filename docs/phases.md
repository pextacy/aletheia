# Phases — Aletheia

Working checklist for the Spark build window, derived from [PLAN.md](PLAN.md) (schedule and gates), [PRD.md](PRD.md) (requirements F1–F8), and [DOCS.md](DOCS.md) (technical spec). PLAN.md is the authority on ordering and cut rules; this file tracks execution state at task granularity.

**Window:** 2026-07-17 → 2026-07-19 20:00 UTC (internal target; hard deadline 23:59 UTC).
**Rule:** a phase starts only when the previous gate passes. Check items off as they complete; a gate is a checklist too — all boxes or no entry.

Status legend: `[ ]` not started · `[x]` done · strike-through = cut (record why in the Notes line of the phase).

---

## Phase 0 — Foundation

**Window:** Jul 17, ~2 h · **Depends on:** nothing

### Tasks

- [ ] Monorepo skeleton: `contracts/`, `bridge/`, `web/`, `cli/`
- [ ] Root `README.md` skeleton with the one-paragraph thesis
- [ ] `.gitignore` (incl. `.env`, `aletheia.sqlite`, build outputs)
- [ ] `.env.example` — every variable from CLAUDE.md §Chain configuration, each with a descriptive comment and an obviously-invalid example value
- [ ] MIT `LICENSE`
- [ ] Create **owner wallet** and **attestor wallet** (separate keys; attestor is low-privilege hot key)
- [ ] Fund both from the Monad testnet faucet with generous margin
- [ ] Record wallet **addresses** (never keys) in `.env.example` comments
- [ ] First commit and push to a public GitHub repo — small, atomic commits from here on; the log is part of the product

### Gate 0

- [ ] Repo public on GitHub
- [ ] Both wallets funded (balance verified on explorer)
- [ ] `forge --version` and `node --version` run clean in the working environment

Notes:

---

## Phase 1 — Contract

**Window:** Jul 17, ~4 h · **Depends on:** Gate 0 · **Covers:** F1 (chain side), F4, F5 groundwork

### Tasks

- [ ] `AletheiaRegistry.sol` per DOCS.md §3:
  - [ ] Storage: `Project` struct, `projects`, `projectByRepo`, `projectCount`
  - [ ] Errors (6): `RepoAlreadyRegistered`, `UnknownProject`, `NotOwner`, `NotAttestor`, `ProjectSealed`, `BadInput`
  - [ ] Events (5): `ProjectRegistered`, `Attested`, `ContractLinked`, `AttestorChanged`, `Sealed`
  - [ ] Functions: `registerProject`, `attest`, `attestBatch`, `linkContract`, `setAttestor`, `seal`
  - [ ] SHA-1 (left-aligned, zero-padded) and SHA-256 hash encodings both accepted as `bytes32`
- [ ] Foundry test suite per DOCS.md §3.5:
  - [ ] Registration uniqueness (`RepoAlreadyRegistered`)
  - [ ] Attestor-only `attest`/`attestBatch`; owner-only `linkContract`/`setAttestor`/`seal`
  - [ ] Batch length mismatch and empty-array reverts (`BadInput`)
  - [ ] Seal blocks **every** mutating path (explicit test per function)
  - [ ] Attestor rotation
  - [ ] Event assertions via `vm.expectEmit` for all five events
  - [ ] Fuzz test on batch sizes
  - [ ] Full lifecycle: register → attest ×N → link → seal → all mutations revert
- [ ] `script/Deploy.s.sol` with chain-ID assertion (`10143`)
- [ ] Deploy to Monad testnet; verify source on explorer
- [ ] Write `deployments/10143.json` (read by bridge and web at build time)
- [ ] **Dogfooding start (F8):** register this repo as project #1 via `cast send` (command documented in README) and submit a manual attestation of current HEAD (commit + tree hash) with the attestor key

### Gate 1

- [ ] `forge test` all green, every revert path exercised
- [ ] Contract source verified on the explorer
- [ ] Project #1 registered with ≥1 `Attested` event visible in explorer logs

Notes:

---

## Phase 2 — Bridge

**Window:** Jul 17 evening → Jul 18 morning, ~5 h · **Depends on:** Gate 1 · **Covers:** F2

### Tasks

- [ ] Fastify app with raw-body capture (content-type parser preserves bytes for HMAC)
- [ ] `POST /webhook/github` pipeline per DOCS.md §4:
  - [ ] Constant-time HMAC verification of `X-Hub-Signature-256`; bad signature ⇒ 401, never 200
  - [ ] Event filtering: only `push`; `ping` ⇒ 204; unknown repo ⇒ 422
  - [ ] Idempotency on `X-GitHub-Delivery` via SQLite `deliveries` table; replay ⇒ 200 `{"status":"duplicate"}`, no chain write
  - [ ] Commit pipeline: payload commits → GitHub API tree SHA fetch → `attest`/`attestBatch`
  - [ ] >20-commit truncation handled via Compare API
  - [ ] `forced: true` flag persisted for timeline markers
- [ ] SQLite persistence: `deliveries` + `submissions` tables, survives restarts
- [ ] Serialized transaction queue: local nonce management, one re-sync retry on nonce errors, failures persisted (never silently lost)
- [ ] `GET /status/:projectId` — recent submissions incl. failure states
- [ ] `GET /healthz` — RPC block number + attestor balance, warn below 0.5 MON
- [ ] Deploy to Railway with persistent volume for `aletheia.sqlite`
- [ ] Configure the real GitHub webhook on this repo
- [ ] End-to-end test: local commit → push → `Attested` event on explorer

### Gate 2

- [ ] Single-commit push ⇒ exactly 1 `Attested` event, <30 s
- [ ] Multi-commit push ⇒ exactly N events via `attestBatch`, <30 s
- [ ] Replayed delivery ⇒ zero duplicate events
- [ ] From here on, every push to this repo self-attests automatically

Notes:

---

## Phase 3 — Proof page and landing

**Window:** Jul 18, full day · **Depends on:** Gate 2 · **Covers:** F1 (UI side), F6

### Tasks

- [ ] Event indexer in `web/`: chunked `eth_getLogs` for all five event types, merged into a typed project model
- [ ] Server-side GitHub metadata enrichment with graceful degradation — chain-only render must be complete (test with GitHub API disabled)
- [ ] `/p/[projectId]`:
  - [ ] Summary strip: first-attestation time, offset from hackathon start `2026-07-13T13:00:00Z`, counts, sealed state
  - [ ] Vertical column timeline with per-entry explorer links and verification badges
  - [ ] Force-push "history rewritten here" markers
  - [ ] Linked contracts inline in chronological position
  - [ ] Copyable `npx aletheia-verify <id>` block
  - [ ] Responsive to 360 px, no horizontal scroll
- [ ] Design identity pass per DOCS.md §5: parchment `#faf6ee` / ink `#1c1a17` / oxblood `#7a2e2e`, Cormorant + Inter, seal iconography, wax-seal treatment when sealed — budget real hours; judges open this first
- [ ] Landing page: thesis paragraph, register flow (wallet connect → repo URL → `registerProject` → webhook instructions with copy buttons + per-project secret), recent-projects list from `ProjectRegistered` logs
- [ ] Clear on-page error for duplicate repo registration (`RepoAlreadyRegistered` surfaced — F1 acceptance)
- [ ] `/api/og/[projectId]` dynamic Open Graph image
- [ ] Deploy to Vercel; all RPC server-side

### Gate 3

- [ ] A stranger with only the Vercel URL can register a test repo and see their push on their proof page, unassisted
- [ ] Project #1's page matches the explorer, link by link
- [ ] Page renders fully with GitHub API disabled

Notes:

---

## Phase 4 — Verification CLI + trustless Action

**Window:** Jul 18 evening → Jul 19 morning, ~4 h · **Depends on:** Gate 3 · **Covers:** F3, F7

### Tasks

- [ ] `cli/` — `aletheia-verify <projectId> [--rpc] [--registry] [--repo]` per DOCS.md §6:
  - [ ] Fetch `ProjectRegistered` + all `Attested` events
  - [ ] Blobless clone (`--filter=blob:none`), full history
  - [ ] Per-commit `git cat-file -e` + `git rev-parse <commit>^{tree}` recomputation
  - [ ] Verdict table: green (match) / yellow (commit missing — rewritten) / red (tree mismatch — substitution)
  - [ ] Non-zero exit on any red; no writes, no keys; deps only Node ≥ 20 + system git
  - [ ] SHA-1 and SHA-256 repo formats auto-detected
- [ ] Negative-path proof: scratch repo → attest → force-push rewritten history → run CLI → capture red-verdict screenshot for README (the threat model made visible)
- [ ] Publish `aletheia-verify` to npm; confirm cold `npx` run works
- [ ] GitHub Action `aletheia.yml` for self-attestation with the project's own key; run green on a scratch repo

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
