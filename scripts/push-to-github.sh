#!/usr/bin/env bash
# Push the project to GitHub as a clean single commit (no local history,
# no .env, no database, no local artifacts).
#
# Usage:
#   GH_TOKEN=github_pat_xxx bash scripts/push-to-github.sh
#   GH_TOKEN=github_pat_xxx bash scripts/push-to-github.sh "commit message"
#
# Env vars:
#   GH_TOKEN  (required) fine-grained PAT with "Contents: Read and write"
#             permission for the target repository
#   OWNER     (optional) default: cw-mod
#   REPO      (optional) default: activiststable
#   BRANCH    (optional) remote branch, default: mistress (repo default)
#
# The token is never stored on disk - it is used only for the push command.
set -euo pipefail
cd "$(dirname "$0")/.."

TOKEN="${GH_TOKEN:-${1:-}}"
if [ -z "$TOKEN" ]; then
  echo "Error: no token. Run: GH_TOKEN=github_pat_xxx bash scripts/push-to-github.sh [message]"
  exit 1
fi

OWNER="${OWNER:-cw-mod}"
REPO="${REPO:-activiststable}"
BRANCH="${BRANCH:-mistress}"
MSG="${2:-Update: учёт активистов по категориям}"
BUILD=".github-build/repo"

# --- assemble a clean copy of the project (whitelist, mirrors .gitignore) ---
rm -rf "$BUILD"
mkdir -p "$BUILD"

shopt -s nullglob dotglob
for item in *; do
  case "$item" in
    node_modules|.next|out|build|coverage|.git|.github-build|.claude|\
    .z-ai-config|.zscripts|db|download|upload|examples|tests|\
    mini-services|agent-ctx|Caddyfile|*.log|.env*|next-env.d.ts|.vercel)
      continue ;;
  esac
  cp -a "$item" "$BUILD/"
done
shopt -u dotglob nullglob

# --- build the single-commit repo ---
cd "$BUILD"
git init -q -b "$BRANCH" 2>/dev/null || git init -q
git config user.name  "${GIT_NAME:-shigasu25-dot}"
git config user.email "${GIT_EMAIL:-320006180+shigasu25-dot@users.noreply.github.com}"
git add -A

if [ -z "$(git diff --cached --name-only 2>/dev/null)" ] && git rev-parse --verify -q HEAD >/dev/null; then
  echo "Nothing to commit."
else
  git commit -q -m "$MSG"
fi

# --- push (force: the remote keeps exactly this one clean commit) ---
if git push --force "https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git" "${BRANCH}:${BRANCH}"; then
  echo "OK: pushed to https://github.com/${OWNER}/${REPO} (branch ${BRANCH})"
else
  rc=$?
  echo "Push failed (exit ${rc})."
  echo "404? The repo may not exist or the token lacks access:"
  echo "  1) create it at https://github.com/new (name: ${REPO}, empty, no README)"
  echo "  2) token settings: Repository access = all/select ${REPO};"
  echo "     Permissions -> Contents = Read and write"
  exit ${rc}
fi
