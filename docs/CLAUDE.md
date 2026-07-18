# CLAUDE.md — Aletheia

Agent instructions for this repository. Read this file fully before writing or modifying any code.

## What this project is

Aletheia is an on-chain build-provenance system for hackathon projects. It seals every GitHub push into a smart contract on Monad, producing an immutable, publicly verifiable timeline that proves *when* a project was built and *what* was built at each step. Git history can be rewritten with forged dates; block timestamps cannot. Aletheia sells that asymmetry.

Three components live in this monorepo:

1. `contracts/` — Solidity registry contract (`AletheiaRegistry.sol`), built with Foundry.
2. `bridge/` — TypeScript webhook service that receives GitHub push events and submits attestations on-chain.
3. `web/` — Next.js app serving the public proof page (`/p/[projectId]`) and the landing page.
4. `cli/` — `aletheia-verify`, an npx-runnable script that independently re-verifies a project's attestations against its Git repository.

## Hard rules — non-negotiable

- **No mock data, no placeholders, no TODO comments, no stub functions.** Every feature you write must work end-to-end against Monad testnet. If a feature cannot be completed properly, do not scaffold it — leave it out entirely and say so.
- **No hardcoded demo state.** The proof page renders exclusively from live chain events and the GitHub API. A judge will click everything twice.
- **No secrets in code or in Git.** All secrets flow through environment variables. `.env` is gitignored; `.env.example` lists every variable with a descriptive comment and an obviously-invalid example value.
- **Fail loudly.** Webhook handler and CLI must surface real errors (invalid signature, RPC failure, nonce conflict) with actionable messages — never swallow exceptions or return fake success.
- **Commit discipline.** Small, atomic commits with imperative-mood messages (`Add batch attestation to registry`). Never amend or rebase published history — this project's whole thesis is honest history. This repo attests itself; the commit log is part of the product.
- **Do not add features outside PRD.md scope.** Roadmap ideas (org accounts, NFT badges, multi-repo) go into the README roadmap section as text only, never into code.

## Stack and versions

- Solidity `^0.8.24`, Foundry (forge/anvil/cast). OpenZeppelin Contracts v5 for `Ownable2Step` only; everything else hand-rolled and small.
- Node.js 20 LTS, TypeScript 5 strict mode everywhere. ESM modules.
- `viem` for all chain interaction (bridge, web, cli). Do not introduce ethers.js.
- Bridge: Fastify. Deployed as a single long-running Node process (Railway). Raw request body must be preserved for HMAC verification — configure Fastify's content type parser accordingly.
- Web: Next.js 14 App Router, Tailwind. Server components fetch chain data; no client-side RPC keys.
- CLI: plain TypeScript compiled with tsup, published as `aletheia-verify` with a `bin` entry, executes `git` via `child_process` — it must run against a fresh `git clone` with no dependencies beyond Node and Git.

## Chain configuration

All chain parameters come from environment variables, never inline:

- `CHAIN_ID` — `10143` (Monad testnet) for this hackathon; `143` for mainnet.
- `RPC_URL` — e.g. `https://testnet-rpc.monad.xyz`.
- `EXPLORER_URL` — e.g. `https://testnet.monadexplorer.com`.
- `REGISTRY_ADDRESS` — deployed `AletheiaRegistry` address.
- `ATTESTOR_PRIVATE_KEY` — bridge-only. This is a low-privilege hot wallet whose sole capability is calling `attest`/`attestBatch` for projects that registered it. It never holds meaningful funds and is never the project owner key.
- `GITHUB_WEBHOOK_SECRET` — HMAC secret for `X-Hub-Signature-256` verification.
- `GITHUB_TOKEN` — read-only token used by web/cli to fetch commit metadata (messages, authors) and by cli to compute tree hashes.

Verify the target chain in every script (`assert chainId === expected`) before sending transactions.

## Commands

- `cd contracts && forge build` / `forge test -vvv` / `forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast`
- `cd bridge && npm run dev` (local, with `smee`/`ngrok` for webhook tunneling) / `npm run build && npm start`
- `cd web && npm run dev` / `npm run build`
- `cd cli && npm run build` / `node dist/index.js verify <projectId> --rpc $RPC_URL --registry $REGISTRY_ADDRESS`

Run `forge test` after every contract change and `tsc --noEmit` after every TypeScript change. Do not commit failing builds.

## Security invariants (enforce in code and tests)

1. Only a project's registered attestor may call `attest`/`attestBatch` for that project; only the owner may call `linkContract`, `setAttestor`, and `seal`.
2. A sealed project rejects all further attestations — test this explicitly.
3. Bridge rejects any webhook whose HMAC signature fails, whose repository does not match a registered project, or whose event type is not `push`. Rejection is a 401/422 with a logged reason, never a 200.
4. Bridge is idempotent: the same delivery ID (`X-GitHub-Delivery`) is never attested twice. Keep a persistent delivery-ID set (Neon Postgres) — process restarts must not cause double attestation.
5. Attestation submission uses a single nonce-managed queue per attestor key; concurrent webhook deliveries must serialize, not race.

## Design identity (web)

Follow DOCS.md §Frontend. Short version ("Cyber-Sovereign"): obsidian-purple base, electric-fuchsia primary + cyan verification accent, Geist type, Material Symbols, frosted-glass panels with neon bloom glows, and a zig-zag proof timeline with glowing nodes. No default-Tailwind-blue, no generic SaaS gradient; everything fits the viewport without horizontal scroll at 360 px and respects reduced motion. The judging rubric explicitly penalizes generic AI-generated UI.

## Definition of done, per feature

A feature is done when: it works against Monad testnet with real transactions; it has tests (contract) or a manual verification note in the PR description (bridge/web); errors are handled; env vars are documented in `.env.example`; and the README section covering it is updated in the same commit.
