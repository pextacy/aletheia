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

Phase 1 (contract) in progress. See [docs/phases.md](docs/phases.md) for the live execution checklist.

## Registering a project from the command line

The web landing page wraps these calls, but nothing about Aletheia requires it. This repository was registered as **project #1** with plain `cast`:

```bash
# repoHash = keccak256 of the lowercase canonical repo path
cast keccak "github.com/pextacy/aletheia"
# → 0xe4a131b80e2dfb2d9655fa864d4c7537e0e69bb4914f98ec8f2795588540f07a

# register (owner key signs; attestor is the bridge hot wallet)
cast send $REGISTRY_ADDRESS \
  "registerProject(bytes32,string,address)" \
  0xe4a131b80e2dfb2d9655fa864d4c7537e0e69bb4914f98ec8f2795588540f07a \
  "https://github.com/pextacy/aletheia" \
  0x89da9812e7F12538119cc58E35bFc62270dDDcFD \
  --rpc-url $RPC_URL --private-key $OWNER_PRIVATE_KEY

# attest the current HEAD manually (attestor key signs).
# Git SHA-1 ids are 20 bytes, left-aligned and zero-padded into bytes32:
COMMIT32=0x$(git rev-parse HEAD)000000000000000000000000
TREE32=0x$(git rev-parse 'HEAD^{tree}')000000000000000000000000
cast send $REGISTRY_ADDRESS \
  "attest(uint256,bytes32,bytes32)" 1 $COMMIT32 $TREE32 \
  --rpc-url $RPC_URL --private-key $ATTESTOR_PRIVATE_KEY
```

## Roadmap

Ideas deliberately out of v1 scope (see [docs/PRD.md](docs/PRD.md) §6): authorship/originality proof, GitLab/Bitbucket support, multi-repo projects, org accounts, NFT badges, mainnet deployment.

## License

MIT — see [LICENSE](LICENSE).
