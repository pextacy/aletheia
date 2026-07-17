# Deploying Aletheia

Production deployment across four components. Do them in order — the contract
address feeds everything downstream.

## 0. Prerequisites

- Two funded wallets on Monad testnet (chain `10143`): an **owner** key (offline)
  and a low-privilege **attestor** hot key. Fund both from
  [faucet.monad.xyz](https://faucet.monad.xyz).
- Foundry (`forge`, `cast`), Node 20, and `git` installed locally.
- A production RPC endpoint. The public `https://testnet-rpc.monad.xyz` caps
  `eth_getLogs` at 100 blocks; the web indexer and CLI adapt to that, but for
  snappy proof pages use an Alchemy/QuickNode Monad endpoint as `RPC_URL`.

Copy `.env.example` to `.env` at the repo root and fill it in.

## 1. Contract → Monad testnet

The whole chain-side setup is one idempotent script:

```bash
./scripts/chain-setup.sh
```

It asserts the chain id, deploys `AletheiaRegistry`, verifies the source on the
explorer, writes `deployments/10143.json` (registry address + deploy block),
registers this repo as **project #1**, attests the current HEAD, and links the
registry contract to the timeline. Re-running it is safe: it skips steps already
done.

After it runs, note the printed `REGISTRY_ADDRESS` and `DEPLOY_BLOCK` — both feed
the bridge and web.

## 2. Bridge → Railway

The bridge is a long-running Node service with a Dockerfile and `railway.json`
(Dockerfile builder, `/healthz` healthcheck, restart-on-failure).

1. New Railway service from this repo, **root directory `bridge`**.
2. Add a **persistent volume** mounted at `/data`.
3. Set env vars:
   | var | value |
   |---|---|
   | `CHAIN_ID` | `10143` |
   | `RPC_URL` | your Monad RPC |
   | `REGISTRY_ADDRESS` | from step 1 |
   | `ATTESTOR_PRIVATE_KEY` | attestor hot key |
   | `GITHUB_WEBHOOK_SECRET` | `openssl rand -hex 32` (the default/global secret) |
   | `GITHUB_TOKEN` | read-only token (higher API limits) |
   | `DB_PATH` | `/data/aletheia.sqlite` |
   | `PORT` | `8787` |
4. Deploy. Confirm `GET /healthz` returns `ok: true` and a non-zero attestor
   balance.
5. On this repo, add the GitHub webhook: **Settings → Webhooks → Add webhook**,
   Payload URL `https://<service>.up.railway.app/webhook/github`, content type
   `application/json`, secret = `GITHUB_WEBHOOK_SECRET`, event = *just the push
   event*. (Per-project secrets registered from the web landing page override the
   global one.)

`git` is installed in the image because `/verify` clones repos to recompute their
hashes.

## 3. Web → Vercel

Server components fetch chain data; no RPC keys reach the browser.

1. New Vercel project from this repo, **root directory `web`**, framework
   Next.js.
2. Set env vars:
   | var | value |
   |---|---|
   | `CHAIN_ID` | `10143` |
   | `RPC_URL` | your Monad RPC (server-side) |
   | `EXPLORER_URL` | `https://testnet.monadexplorer.com` |
   | `REGISTRY_ADDRESS` | from step 1 |
   | `DEPLOY_BLOCK` | from step 1 |
   | `GITHUB_TOKEN` | read-only token (commit metadata) |
   | `NEXT_PUBLIC_ATTESTOR_ADDRESS` | attestor address |
   | `NEXT_PUBLIC_BRIDGE_URL` | the Railway URL from step 2 |
   | `NEXT_PUBLIC_SITE_URL` | the final Vercel URL (for OG image resolution) |
3. Deploy. Open `/p/1` and confirm project #1's timeline renders with the live
   verification banner.

## 4. CLI → npm

```bash
cd cli && npm publish
```

The package is publish-ready (bin entry, `files` allowlist, README). Confirm a
cold run works: `npx aletheia-verify 1 --registry <REGISTRY_ADDRESS>`. Once a
default registry is baked into the CLI, the flag becomes optional.

## Optional: Neon read-index (faster pages)

The web app can index registry events into Neon Postgres so pages don't re-scan
the chain over RPC on every request. It is **entirely optional** — with
`DATABASE_URL` unset the app runs purely on RPC, and even when set, any index
miss or error falls back to RPC transparently.

To enable:

1. Create a Neon database; set `DATABASE_URL` (a `postgres://…` string) in the
   Vercel project.
2. Set `SYNC_SECRET` to a random string — the `/api/sync` route requires it as
   `?token=` or a `Bearer` header. (If unset, the route is open; always set it
   in production.)
3. Point a scheduler (Vercel Cron, a GitHub Action, or the bridge) at
   `POST /api/sync?token=$SYNC_SECRET` — e.g. once a minute. It incrementally,
   idempotently pulls new events since the last synced block.
4. The `/stats` dashboard reads from the index when present.

## Verification checklist

- `GET /healthz` on the bridge is green; attestor balance > 0.5 MON.
- A push to a registered repo produces an `Attested` event within ~30 s.
- `/p/1` shows the "Independently verified" banner (bridge `/verify` reachable).
- `npx aletheia-verify 1` from a clean machine returns all green.
- Contract source is verified on the explorer.
