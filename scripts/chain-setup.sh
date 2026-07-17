#!/usr/bin/env bash
# One-shot chain setup for Aletheia: deploy → verify → register project #1 →
# attest HEAD. Idempotent where possible; every step prints its explorer link.
#
# Prerequisites: funded owner + attestor wallets, .env at the repo root with
# OWNER_PRIVATE_KEY, ATTESTOR_PRIVATE_KEY, RPC_URL, CHAIN_ID, EXPLORER_URL.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; source .env; set +a
: "${RPC_URL:?}" "${CHAIN_ID:?}" "${OWNER_PRIVATE_KEY:?}" "${ATTESTOR_PRIVATE_KEY:?}"
EXPLORER_URL=${EXPLORER_URL:-https://testnet.monadexplorer.com}

OWNER_ADDR=$(cast wallet address "$OWNER_PRIVATE_KEY")
ATTESTOR_ADDR=$(cast wallet address "$ATTESTOR_PRIVATE_KEY")
REPO_PATH="github.com/pextacy/aletheia"
REPO_URL="https://github.com/pextacy/aletheia"

echo "chain    $(cast chain-id --rpc-url "$RPC_URL") (expect $CHAIN_ID)"
[ "$(cast chain-id --rpc-url "$RPC_URL")" = "$CHAIN_ID" ] || { echo "wrong chain"; exit 1; }

OWNER_BAL=$(cast balance "$OWNER_ADDR" --rpc-url "$RPC_URL")
ATT_BAL=$(cast balance "$ATTESTOR_ADDR" --rpc-url "$RPC_URL")
echo "owner    $OWNER_ADDR  $(cast from-wei "$OWNER_BAL") MON"
echo "attestor $ATTESTOR_ADDR  $(cast from-wei "$ATT_BAL") MON"
[ "$OWNER_BAL" != "0" ] || { echo "owner wallet is unfunded — visit https://faucet.monad.xyz"; exit 1; }
[ "$ATT_BAL" != "0" ] || { echo "attestor wallet is unfunded — visit https://faucet.monad.xyz"; exit 1; }

# ── 1. Deploy (skipped if deployments/<chainId>.json already exists) ──────────
DEPLOY_JSON="deployments/${CHAIN_ID}.json"
if [ -s "$DEPLOY_JSON" ]; then
  echo "deploy: $DEPLOY_JSON exists, skipping"
else
  echo "── deploying AletheiaRegistry…"
  (cd contracts && CHAIN_ID="$CHAIN_ID" forge script script/Deploy.s.sol \
      --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY" --broadcast)
fi
REGISTRY=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['registry'])")
DEPLOY_BLOCK=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON')).get('block',0))")
echo "registry $REGISTRY (block $DEPLOY_BLOCK)"
echo "         $EXPLORER_URL/address/$REGISTRY"

# ── 2. Verify source on the explorer (Sourcify — Monad explorer reads it) ─────
echo "── verifying source…"
(cd contracts && forge verify-contract "$REGISTRY" src/AletheiaRegistry.sol:AletheiaRegistry \
    --chain-id "$CHAIN_ID" --verifier sourcify --watch) || \
  echo "warning: source verification failed — retry manually with forge verify-contract"

# ── 3. Register project #1 (skipped if the repo is already registered) ────────
REPO_HASH=$(cast keccak "$REPO_PATH")
PROJECT_ID=$(cast call "$REGISTRY" "projectByRepo(bytes32)(uint256)" "$REPO_HASH" --rpc-url "$RPC_URL")
if [ "$PROJECT_ID" = "0" ]; then
  echo "── registering $REPO_PATH…"
  cast send "$REGISTRY" "registerProject(bytes32,string,address)" \
    "$REPO_HASH" "$REPO_URL" "$ATTESTOR_ADDR" \
    --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY" >/dev/null
  PROJECT_ID=$(cast call "$REGISTRY" "projectByRepo(bytes32)(uint256)" "$REPO_HASH" --rpc-url "$RPC_URL")
fi
echo "project #$PROJECT_ID"

# ── 4. Attest current HEAD with the attestor key ──────────────────────────────
COMMIT=$(git rev-parse HEAD)
TREE=$(git rev-parse 'HEAD^{tree}')
pad() { printf '%s' "$1"; local n=$(( 64 - ${#1} )); [ "$n" -gt 0 ] && printf '0%.0s' $(seq 1 $n) || true; }
COMMIT32=0x$(pad "$COMMIT")
TREE32=0x$(pad "$TREE")
echo "── attesting HEAD $COMMIT…"
TX=$(cast send "$REGISTRY" "attest(uint256,bytes32,bytes32)" "$PROJECT_ID" "$COMMIT32" "$TREE32" \
  --rpc-url "$RPC_URL" --private-key "$ATTESTOR_PRIVATE_KEY" --json | python3 -c "import json,sys;print(json.load(sys.stdin)['transactionHash'])")
echo "attested: $EXPLORER_URL/tx/$TX"

# ── 5. Link the registry contract itself to the timeline ──────────────────────
echo "── linking registry contract to the timeline…"
cast send "$REGISTRY" "linkContract(uint256,address,string)" "$PROJECT_ID" "$REGISTRY" "AletheiaRegistry v1" \
  --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY" >/dev/null || echo "(link failed — rerun manually)"

echo
echo "Done. Next: set REGISTRY_ADDRESS=$REGISTRY and DEPLOY_BLOCK=$DEPLOY_BLOCK in bridge/web env,"
echo "then run the CLI check:  ALETHEIA_REGISTRY=$REGISTRY node cli/dist/index.js $PROJECT_ID"
