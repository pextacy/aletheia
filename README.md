# Aletheia

**On-chain build provenance — proof you built it, when you said you did.**

Git history is author-controlled and trivially forgeable: `git commit --date` fabricates timestamps and a force-push rewrites the record silently. That leaves honest hackathon builders unable to prove they built within the rules, while judging agents fall back on fallible heuristics. Aletheia closes that gap by binding a GitHub repository to a smart contract on Monad: every push is sealed on-chain — commit hash, tree hash, block timestamp — within seconds, producing an immutable public timeline of when a project started, how it evolved commit by commit, and the moment its record was sealed for submission. An independent CLI lets anyone, human or judging agent, re-verify the entire record from a fresh clone. Trust moves from the author to the chain: Git dates can be forged; block timestamps cannot. This repository is Aletheia's own project #1 — the build you are reading was notarized by the tool it produced.

## Monorepo layout

| Directory | Contents |
|---|---|
| `contracts/` | `AletheiaRegistry.sol` — Solidity registry, Foundry |
| `bridge/` | Fastify webhook service: GitHub push → on-chain attestation |
| `web/` | Next.js app: landing page + public proof pages (`/p/[projectId]`) |
| `cli/` | `aletheia-verify` — independent verification CLI (npx-runnable) |
| `docs/` | PRD, technical documentation, execution plan |

## Status

Phase 0 (foundation) in progress. See [docs/phases.md](docs/phases.md) for the live execution checklist.

## Roadmap

Ideas deliberately out of v1 scope (see [docs/PRD.md](docs/PRD.md) §6): authorship/originality proof, GitLab/Bitbucket support, multi-repo projects, org accounts, NFT badges, mainnet deployment.

## License

MIT — see [LICENSE](LICENSE).
