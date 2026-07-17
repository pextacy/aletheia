# PRD — Aletheia

Product requirements for the Spark hackathon build (BuildAnything, submission deadline 2026-07-19 23:59 UTC, Monad testnet).

## 1. Problem

Hackathon judging now includes automated fraud detection: the Spark judging agent checks whether projects were started before the hackathon, whether demos run on static placeholder data, and whether commit histories look suspicious. Honest builders have no way to *prove* their innocence, because the only record of their process — Git history — is fully author-controlled and trivially forgeable (`git commit --date`, force-push). The result is an asymmetry: cheaters can fabricate a clean-looking history, and honest builders can be flagged by heuristics with no recourse.

Personal framing (required by the hackathon brief): "I am competing in this hackathon. The judge is an AI agent scanning everyone for fraud. I wanted to prove I built honestly — and no tool existed to do it. So I built the tool, and used it on itself."

## 2. Solution

Aletheia binds a GitHub repository to a Monad smart contract. Every push is sealed on-chain (commit hash + tree hash + block timestamp) within seconds. The output is a public proof page: an immutable timeline showing when the project started, how it evolved commit by commit, which contracts it deployed and when, and the moment the record was sealed for submission. An independent CLI lets anyone — including a judging agent — re-verify the entire record from a fresh clone.

Trust moves from the author to the chain: Git dates can be forged; block timestamps cannot.

## 3. Users

- **Primary:** hackathon participants who want verifiable proof of honest, in-window building. Initial audience: the 546 registered Spark builders.
- **Secondary:** hackathon organizers and judging agents, who get a verification endpoint instead of heuristics. The Spark judges are themselves the clearest secondary user — the product answers the exact questions their agent asks.
- **Tertiary:** build-in-public developers who want tamper-evident timelines for any project.

## 4. Functional requirements

**F1 — Project registration.** A user connects a wallet on the landing page, submits a GitHub repo URL, and signs `registerProject`. The app derives `repoHash`, generates per-project webhook instructions (URL + HMAC secret), and displays them with copy buttons. One project per repo, enforced on-chain. Acceptance: a second registration of the same repo fails with a clear on-page error surfaced from the `RepoAlreadyRegistered` revert.

**F2 — Push attestation via bridge.** A `git push` to a registered repo results in an `Attested` event on Monad within 30 seconds under normal RPC conditions. Multi-commit pushes use `attestBatch`. Invalid signatures, unknown repos, and replayed deliveries are rejected without chain writes. Acceptance: pushing 3 commits produces exactly 3 `Attested` events with correct commit and tree hashes, verified manually against `git rev-parse`.

**F3 — Push attestation via GitHub Action (trustless path).** A published workflow file lets a project attest its own pushes with its own key, bypassing the bridge entirely. Acceptance: the workflow runs green on this repo and produces a valid attestation.

**F4 — Contract linking.** The owner can bind a deployed contract address with a label ("AletheiaRegistry v1") to the timeline. Acceptance: linked contract appears in chronological position on the proof page with an explorer link.

**F5 — Sealing.** The owner can permanently close the record. All subsequent mutations revert. The proof page displays sealed status and seal time prominently. Acceptance: post-seal attestation attempt reverts; page shows the wax-seal state.

**F6 — Proof page.** `/p/[projectId]` renders entirely from live chain events, enriched (not gated) by GitHub commit metadata: summary strip (first attestation time, offset from hackathon start, counts, sealed status), vertical timeline with per-commit chain timestamps, explorer links, verification badges, force-push markers, and a copyable verify command. Acceptance: page renders correctly with GitHub API disabled; every explorer link resolves; renders without horizontal scroll at 360 px.

**F7 — Independent verification CLI.** `npx aletheia-verify <projectId>` clones the repo, recomputes commit/tree pairs, compares against chain events, prints a per-commit verdict table, exits non-zero on mismatch. No keys, no writes. Acceptance: run against this repo returns all green; run against a deliberately rewritten test repo returns red and non-zero exit.

**F8 — Dogfooding.** This repository is project #1, registered within the first hours of the build. The demo video's centerpiece is Aletheia's own proof page. Acceptance: by submission, project #1 shows the full build timeline and is sealed on camera.

## 5. Non-functional requirements

- **Integrity:** no mock data anywhere; all rendered state originates on-chain. Idempotent webhook processing across restarts (persistent delivery-ID store).
- **Security:** HMAC-verified webhooks; low-privilege rotatable attestor key; owner key never on a server; secrets only via env.
- **Performance:** proof page TTFB under 2 s with event-log chunking; bridge attestation latency under 30 s p95.
- **Design:** distinctive identity per DOCS.md §5 (parchment/ink/oxblood, Cormorant + Inter, column timeline, seal motif). Explicitly not a default-Tailwind SaaS look — the judging rubric penalizes generic AI UI.
- **Comprehensibility:** README lets a stranger register, push, and verify in under 3 minutes of reading; includes architecture diagram and threat model.

## 6. Non-goals (v1)

Authorship/originality proof (timing only — stated honestly in UI and README); GitLab/Bitbucket; multi-repo projects; org accounts; NFT badges; mainnet deployment; token or payment of any kind; historical back-attestation of pre-existing commits (by design — Aletheia only ever attests the present).

## 7. Success criteria

- Hackathon submission complete with all required fields: hosted URL (Vercel), public repo, testnet category, verified contract address, ≤3-minute demo video, social post URL.
- The judging agent's three published checks (start time, placeholder data, suspicious commits) are each directly answerable from Aletheia's own proof page — the submission demonstrates this mapping explicitly.
- End-to-end demo: live push → on-chain seal → timeline update, captured in one unbroken screen recording.
- At least one project other than Aletheia itself registered before the deadline (recruited from the Spark Discord), demonstrating third-party usability.

## 8. Submission field mapping

- **Name:** Aletheia. **Description:** On-chain build provenance — proof you built it, when you said you did.
- **Problem:** Git history is forgeable, so honest hackathon builders cannot prove they built within the rules, while judging agents rely on fallible heuristics.
- **Solution:** Every push is sealed on Monad with commit + tree hashes; a public timeline and an independent verification CLI make the build record tamper-evident and third-party checkable. Trust moves from the author to the chain.
- **Category:** Testnet. **Contract address:** `AletheiaRegistry` deployment from `deployments/10143.json` (verified source).
- **Demo video beats:** the asymmetry problem (20 s) → live push-to-seal flow (90 s) → reveal that the project on screen is Aletheia documenting itself (40 s) → on-camera `seal()` (10 s).
