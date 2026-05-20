#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# git-bisect-guide.sh — Interactive guide to find when TSC errors were introduced.
# 
# USAGE (after you've set up git history):
#   git bisect start
#   git bisect bad                     # current commit is broken
#   git bisect good <last-known-good>  # a commit SHA when it compiled
#   git bisect run ./scripts/git-bisect-guide.sh
#
# Git will binary-search commits, running this script on each.
# Exit 0 = good commit, exit 1 = bad commit.
# ─────────────────────────────────────────────────────────────────────────────
FRONTEND="$(cd "$(dirname "$0")/../frontend" && pwd)"
cd "$FRONTEND"

# Install deps quietly (each bisect step needs them)
npm install --legacy-peer-deps --ignore-scripts --silent 2>/dev/null || true

# Count JSX structural errors only (the original problem)
TSC_OUT=$(npx tsc --noEmit 2>&1 || true)
JSX_ERRORS=$(echo "$TSC_OUT" | grep -c "error TS17\|error TS1003\|error TS1005\|error TS1128" 2>/dev/null || echo 0)

echo "JSX structural errors at this commit: $JSX_ERRORS"

[[ $JSX_ERRORS -eq 0 ]] && exit 0 || exit 1
