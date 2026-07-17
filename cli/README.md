# aletheia-verify

Independent verification CLI for [Aletheia](https://github.com/pextacy/aletheia) — on-chain build provenance on Monad.

```bash
npx aletheia-verify <projectId> [--rpc <url>] [--registry <address>] [--repo <clone-url>]
```

The CLI reads a project's `ProjectRegistered` and `Attested` events from the AletheiaRegistry contract, clones the registered repository (blobless, full history), recomputes every attested commit and tree hash with plain `git`, and prints a verdict per attestation:

- **✓ VERIFIED** (green) — commit present, tree hash matches the chain.
- **● MISSING** (yellow) — commit absent from the repo: history was rewritten after attestation.
- **✗ MISMATCH** (red) — tree hash differs: content was substituted. Exit code becomes non-zero.

No keys, no writes, no trust in Aletheia's own infrastructure — only Node ≥ 20, a system `git`, and an RPC endpoint. SHA-1 and SHA-256 repository object formats are both detected automatically.

`--registry` defaults to the `ALETHEIA_REGISTRY` environment variable; `--rpc` defaults to the public Monad testnet RPC. `--repo` overrides the clone URL recorded on-chain (useful for mirrors). `--from-block` overrides the block the event scan starts at; by default the CLI derives it from the project's on-chain registration timestamp, so it never scans from genesis (which would fan out into far too many requests on an RPC that caps `eth_getLogs` to a small block range, such as Monad's public endpoint).

## What a verdict means

Aletheia proves **existence by time** (the attested tree existed no later than the block timestamp) and **continuity** (the sequence of attestations shows incremental evolution). It does not prove authorship. A red verdict means the repository's current content cannot reproduce what was attested — the record was tampered with after the fact.
