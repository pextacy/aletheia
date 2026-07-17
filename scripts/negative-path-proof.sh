#!/usr/bin/env bash
# Negative-path proof: demonstrate that aletheia-verify catches a rewritten
# history. Creates a scratch repo on GitHub, registers + attests it, then
# force-pushes substituted content and runs the CLI — which must exit red.
#
# Usage: scripts/negative-path-proof.sh <scratch-repo-name>
# Prerequisites: funded wallets, deployed registry (deployments/<chainId>.json),
# gh CLI authenticated, .env at the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."

SCRATCH=${1:?usage: negative-path-proof.sh <scratch-repo-name>}
set -a; source .env; set +a
: "${RPC_URL:?}" "${CHAIN_ID:?}" "${OWNER_PRIVATE_KEY:?}" "${ATTESTOR_PRIVATE_KEY:?}"

REGISTRY=$(python3 -c "import json;print(json.load(open('deployments/${CHAIN_ID}.json'))['registry'])")
ATTESTOR_ADDR=$(cast wallet address "$ATTESTOR_PRIVATE_KEY")
GH_USER=$(gh api user --jq .login)
FULL_NAME_LC=$(printf '%s/%s' "$GH_USER" "$SCRATCH" | tr '[:upper:]' '[:lower:]')

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "── creating scratch repo $GH_USER/$SCRATCH…"
gh repo create "$SCRATCH" --public --clone=false
git init -q -b main "$WORK/repo"
cd "$WORK/repo"
echo "honest work, attested on time" > work.txt
git add . && git -c user.name=aletheia-proof -c user.email=proof@invalid commit -qm "Honest commit"
git remote add origin "https://github.com/$GH_USER/$SCRATCH.git"
git push -qu origin main

pad() { printf '%s' "$1"; local n=$(( 64 - ${#1} )); [ "$n" -gt 0 ] && printf '0%.0s' $(seq 1 $n) || true; }
COMMIT=$(git rev-parse HEAD); TREE=$(git rev-parse 'HEAD^{tree}')

echo "── registering + attesting the honest commit…"
REPO_HASH=$(cast keccak "github.com/$FULL_NAME_LC")
cast send "$REGISTRY" "registerProject(bytes32,string,address)" \
  "$REPO_HASH" "https://github.com/$GH_USER/$SCRATCH" "$ATTESTOR_ADDR" \
  --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY" >/dev/null
PROJECT_ID=$(cast call "$REGISTRY" "projectByRepo(bytes32)(uint256)" "$REPO_HASH" --rpc-url "$RPC_URL")
cast send "$REGISTRY" "attest(uint256,bytes32,bytes32)" "$PROJECT_ID" "0x$(pad "$COMMIT")" "0x$(pad "$TREE")" \
  --rpc-url "$RPC_URL" --private-key "$ATTESTOR_PRIVATE_KEY" >/dev/null
echo "project #$PROJECT_ID attested commit $COMMIT"

echo "── rewriting history (the cheat)…"
git checkout -q --orphan rewritten
echo "totally different content, backdated" > work.txt
git add . && git -c user.name=aletheia-proof -c user.email=proof@invalid commit -qm "Honest commit"
git branch -qD main && git branch -qm main
git push -qf origin main

echo "── running aletheia-verify (must exit non-zero, red verdict)…"
cd "$OLDPWD"
if ALETHEIA_REGISTRY=$REGISTRY node cli/dist/index.js "$PROJECT_ID" --rpc "$RPC_URL"; then
  echo "FAIL: CLI exited 0 against rewritten history"; exit 1
else
  echo "PASS: CLI flagged the rewritten history (screenshot the output above for the README)"
fi
