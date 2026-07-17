#!/usr/bin/env bash
# Preflight doctor: read-only check that everything needed to deploy Aletheia is
# in place. Makes no writes and sends no transactions — run it before
# chain-setup.sh and before configuring Railway/Vercel. Exits non-zero if any
# hard check fails.
#
# Usage: ./scripts/preflight.sh
set -uo pipefail
cd "$(dirname "$0")/.."

PASS=0 WARN=0 FAIL=0
green() { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
warn()  { printf '  \033[33m!\033[0m %s\n' "$1"; WARN=$((WARN + 1)); }
fail()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }

echo "── Tooling"
command -v forge >/dev/null && green "forge ($(forge --version 2>/dev/null | head -1))" || fail "forge not installed"
command -v cast  >/dev/null && green "cast present" || fail "cast not installed"
command -v git   >/dev/null && green "git ($(git --version | awk '{print $3}'))" || fail "git not installed"
command -v node  >/dev/null && {
  NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
  [ "$NODE_MAJOR" -ge 20 ] && green "node $(node -v)" || fail "node $(node -v) — need >= 20"
} || fail "node not installed"

echo "── Environment (.env)"
if [ -f .env ]; then
  green ".env present"
  set -a; source .env; set +a
else
  fail ".env missing — copy .env.example and fill it in"
fi

req() { # name -> pass if set and not an INVALID placeholder
  local v="${!1:-}"
  if [ -z "$v" ]; then fail "$1 not set"; return; fi
  case "$v" in
    *INVALID*|0x0000000000000000000000000000000000000000) warn "$1 is a placeholder";;
    *) green "$1 set";;
  esac
}
for v in CHAIN_ID RPC_URL EXPLORER_URL REGISTRY_ADDRESS ATTESTOR_PRIVATE_KEY GITHUB_WEBHOOK_SECRET; do req "$v"; done

echo "── Chain"
CHAIN_ID="${CHAIN_ID:-}"; RPC_URL="${RPC_URL:-}"
if [ -n "$RPC_URL" ]; then
  ONCHAIN=$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || echo "")
  if [ -z "$ONCHAIN" ]; then
    fail "RPC unreachable at $RPC_URL"
  elif [ "$ONCHAIN" = "$CHAIN_ID" ]; then
    green "RPC reachable, chain id $ONCHAIN matches CHAIN_ID"
  else
    fail "RPC chain id $ONCHAIN != CHAIN_ID $CHAIN_ID"
  fi
fi

echo "── Wallets"
if [ -n "${ATTESTOR_PRIVATE_KEY:-}" ] && [[ "$ATTESTOR_PRIVATE_KEY" == 0x* ]] && [[ "$ATTESTOR_PRIVATE_KEY" != *INVALID* ]]; then
  ATT_ADDR=$(cast wallet address "$ATTESTOR_PRIVATE_KEY" 2>/dev/null || echo "")
  if [ -n "$ATT_ADDR" ]; then
    green "attestor key valid → $ATT_ADDR"
    if [ -n "${NEXT_PUBLIC_ATTESTOR_ADDRESS:-}" ] && [ "${NEXT_PUBLIC_ATTESTOR_ADDRESS,,}" != "${ATT_ADDR,,}" ]; then
      warn "NEXT_PUBLIC_ATTESTOR_ADDRESS != the key's address (web will offer the wrong attestor)"
    fi
    if [ -n "$RPC_URL" ]; then
      BAL=$(cast balance "$ATT_ADDR" --rpc-url "$RPC_URL" 2>/dev/null || echo 0)
      MON=$(cast from-wei "${BAL:-0}" 2>/dev/null || echo 0)
      if [ "${BAL:-0}" = "0" ]; then fail "attestor unfunded — visit https://faucet.monad.xyz"
      else awk "BEGIN{exit !($MON < 0.5)}" && warn "attestor low: $MON MON (< 0.5)" || green "attestor funded: $MON MON"; fi
    fi
  else
    fail "attestor key invalid"
  fi
fi
if [ -n "${OWNER_PRIVATE_KEY:-}" ] && [[ "$OWNER_PRIVATE_KEY" == 0x* ]] && [[ "$OWNER_PRIVATE_KEY" != *INVALID* ]]; then
  OWN_ADDR=$(cast wallet address "$OWNER_PRIVATE_KEY" 2>/dev/null || echo "")
  if [ -n "$OWN_ADDR" ] && [ -n "$RPC_URL" ]; then
    OBAL=$(cast balance "$OWN_ADDR" --rpc-url "$RPC_URL" 2>/dev/null || echo 0)
    [ "${OBAL:-0}" = "0" ] && fail "owner unfunded — needed to deploy + register" || green "owner funded: $(cast from-wei "$OBAL") MON"
  fi
else
  warn "OWNER_PRIVATE_KEY not set (needed only for the deploy/register step)"
fi

echo "── Contract"
REGISTRY_ADDRESS="${REGISTRY_ADDRESS:-}"
if [ -n "$RPC_URL" ] && [[ "$REGISTRY_ADDRESS" == 0x* ]] && [ "$REGISTRY_ADDRESS" != "0x0000000000000000000000000000000000000000" ]; then
  CODE=$(cast code "$REGISTRY_ADDRESS" --rpc-url "$RPC_URL" 2>/dev/null || echo "0x")
  [ "${CODE:-0x}" != "0x" ] && green "registry deployed at $REGISTRY_ADDRESS (has code)" || fail "no contract code at REGISTRY_ADDRESS — run scripts/chain-setup.sh"
else
  warn "REGISTRY_ADDRESS not yet a deployed address (expected before first deploy)"
fi

echo
printf 'preflight: \033[32m%d pass\033[0m · \033[33m%d warn\033[0m · \033[31m%d fail\033[0m\n' "$PASS" "$WARN" "$FAIL"
[ "$FAIL" -eq 0 ] && { echo "ready — proceed with scripts/chain-setup.sh"; exit 0; } || { echo "not ready — resolve the ✗ items above"; exit 1; }
