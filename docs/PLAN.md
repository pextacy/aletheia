# PLAN — Aletheia

Execution plan for the Spark build window. Now: 2026-07-17. Deadline: 2026-07-19 23:59 UTC. Internal submission target: 2026-07-19 20:00 UTC (3-hour buffer, non-negotiable). Phases are strictly ordered; a phase is entered only when the previous phase's gate passes. Anything not in this plan does not get built — new ideas go to the README roadmap as text.

## Phase 0 — Foundation (Jul 17, ~2 h)

1. Initialize monorepo (`contracts/`, `bridge/`, `web/`, `cli/`), root README skeleton with the one-paragraph thesis, `.gitignore`, `.env.example`, MIT license.
2. Create attestor wallet and owner wallet; fund both from the Monad testnet faucet with generous margin; record addresses in `.env.example` comments (addresses only, never keys).
3. First commit and push. From this moment, commit small and often — the log is part of the product.

**Gate 0:** repo public on GitHub, both wallets funded, `forge --version` and `node --version` verified in the working environment.

## Phase 1 — Contract (Jul 17, ~4 h)

1. Write `AletheiaRegistry.sol` exactly per DOCS.md §3: storage structs, six errors, five events, `registerProject`, `attest`, `attestBatch`, `linkContract`, `setAttestor`, `seal`.
2. Foundry test suite per DOCS.md §3.5 — every revert path, event assertions via `vm.expectEmit`, fuzz on batch sizes, full-lifecycle test (register → attest ×N → link → seal → all mutations revert).
3. `script/Deploy.s.sol` with chain-ID assertion; deploy to Monad testnet; verify source on the explorer; write `deployments/10143.json`.
4. **Register this repo as project #1** via a `cast send` documented in the README, and submit the first manual attestation of the current HEAD (commit + tree hash) using the attestor key — the dogfooding clock starts here, before the bridge exists.

**Gate 1:** all tests green; contract verified on explorer; project #1 registered with ≥1 attestation visible in explorer event logs.

## Phase 2 — Bridge (Jul 17 evening → Jul 18 morning, ~5 h)

1. Fastify app with raw-body capture; HMAC verification (constant-time), event filtering, `ping` handling.
2. Neon Postgres persistence (`deliveries`, `submissions` tables); idempotency on `X-GitHub-Delivery`.
3. Serialized transaction queue with local nonce management and one re-sync retry on nonce errors; failure states persisted and exposed at `GET /status/:projectId`.
4. Commit pipeline: payload commits → GitHub API tree SHA fetch → truncation handling via Compare API when >20 commits → `attest`/`attestBatch` submission; force-push flag persisted.
5. `GET /healthz` with RPC and attestor-balance checks.
6. Deploy to Railway with persistent volume; configure the real GitHub webhook on this repo; end-to-end test: local commit → push → event on explorer.

**Gate 2:** three consecutive real pushes (single-commit, multi-commit, and a replayed delivery) behave exactly per spec — 3 attestation events total, zero duplicates, latency <30 s each. From here on, every push to this repo self-attests automatically.

## Phase 3 — Proof page and landing (Jul 18, full day)

1. Event indexer module in `web/`: chunked `eth_getLogs` for all five event types, merged into a typed project model; server-side GitHub metadata enrichment with graceful degradation (chain-only render must be complete).
2. `/p/[projectId]`: summary strip (first-seal time, offset from hackathon start `2026-07-13T13:00:00Z`, counts, sealed state), vertical column timeline, per-entry explorer links and verification badges, force-push markers, inline linked contracts, copyable verify command. Responsive to 360 px.
3. Design identity pass per DOCS.md §5 — parchment/ink/oxblood palette, Cormorant + Inter, seal iconography, wax-seal treatment for sealed projects. Budget real hours here; this is what the judges open first.
4. Landing page: thesis paragraph, register flow (wallet connect → repo URL → `registerProject` → webhook instructions with copy buttons and per-project secret), recent-projects list from `ProjectRegistered` logs.
5. `/api/og/[projectId]` dynamic Open Graph image.
6. Deploy to Vercel; confirm project #1's page renders the full live timeline.

**Gate 3:** a stranger given only the Vercel URL can register a test repo and see their push appear on their proof page without any help; project #1's page is accurate against the explorer, link by link.

## Phase 4 — Verification CLI + trustless Action (Jul 18 evening → Jul 19 morning, ~4 h)

1. `cli/`: `aletheia-verify <projectId>` per DOCS.md §6 — event fetch, blobless clone, per-commit `git cat-file`/`rev-parse` recomputation, verdict table (green/yellow/red), non-zero exit on red. SHA-1 and SHA-256 repo formats both handled.
2. Negative-path proof: create a scratch repo, attest, force-push rewritten history, run the CLI, capture the red-verdict output as a README screenshot — this screenshot is the threat model made visible.
3. Publish `aletheia-verify` to npm so `npx` works cold.
4. GitHub Action workflow (`aletheia.yml`) for self-attestation with the project's own key; run it green on a scratch repo.

**Gate 4:** `npx aletheia-verify 1` from a machine that has never seen this codebase returns all green; the rigged repo returns red.

## Phase 5 — Package and ship (Jul 19, hard stop 20:00 UTC)

1. **README final pass (morning):** thesis, architecture diagram, threat model incl. honest out-of-scope list, 3-minute quickstart, verify instructions, roadmap section absorbing all cut ideas, screenshots. The Mystery Box failure mode dies here.
2. **Judging-agent mapping section** in the README: a short table pairing each published agent check (start time, placeholder data, suspicious commits) with the exact Aletheia artifact that answers it for this submission.
3. **Demo video (midday, ≤3 min):** one unbroken screen recording for the core flow. Beats: the asymmetry problem (20 s) → live commit → push → on-chain seal → timeline update (90 s) → reveal: "the project you're watching is Aletheia's own proof page — here is my entire build, sealed block by block" (40 s) → on-camera `seal(1)` transaction: "and I seal it" (10 s). Upload, verify public visibility in an incognito window.
4. **Social post:** the innocence-proof angle ("The judge is an AI scanning for fraud. I built the tool that proves I'm clean — and it notarized its own creation"), proof-page link with the OG image, posted and pinned; drop the link in the Spark Discord and invite other builders to register (feeds the F7 third-party success criterion and the viral prize).
5. **Recruit ≥1 external project** from Discord onto the platform; assist them live if needed.
6. **Submission form (by 20:00 UTC):** all fields per PRD §8; every URL opened and tested from a logged-out browser before submitting.
7. Post-submission: monitor `/healthz` and the Discord; fix nothing cosmetic, hotfix only availability.

**Gate 5 (final):** submission confirmed on the platform; demo video public; proof page of project #1 sealed; CLI verifies it green; social post live.

## Standing rules

- Buffer discipline: if any phase overruns by more than 2 hours, cut from the tail of that phase, never from README/video/submission time. The cut order within web is: OG image → recent-projects list → landing polish. The proof page and CLI are never cut.
- The attestor key funds are checked at every phase gate.
- Every gate check is performed against live Monad testnet, never a local anvil node.
