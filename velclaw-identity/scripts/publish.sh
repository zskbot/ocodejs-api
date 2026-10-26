#!/usr/bin/env bash
# Publish this val's source to a GitHub repo — creates the repo if missing.
#
# Usage:
#   GH_TOKEN=ghp_xxx bash scripts/publish.sh [owner/repo]
#
#   Default target: zskbot/ocodejs-api
#
# Needs: curl, git, and a GitHub token with `repo` scope (classic) or
# `Contents: write` + `Administration: write` (fine-grained).
#
# The token is read from the environment only. It is never written to disk,
# never echoed, and never placed in a remote URL.

set -euo pipefail

TARGET="${1:-zskbot/ocodejs-api}"
OWNER="${TARGET%%/*}"
REPO="${TARGET##*/}"
BRANCH="${BRANCH:-main}"
DEST="${DEST:-ocodejs-api}"

: "${GH_TOKEN:?Set GH_TOKEN to a GitHub token with repo scope}"

API="https://api.github.com"

echo "Target: ${OWNER}/${REPO} (branch: ${BRANCH})"

# --- 1. Create the repo if it doesn't exist ------------------------------
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${GH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "${API}/repos/${OWNER}/${REPO}")

if [ "$status" = "404" ]; then
  echo "Repo missing — creating…"
  code=$(curl -s -o /tmp/gh-create.json -w '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "${API}/user/repos" \
    -d "{\"name\":\"${REPO}\",\"private\":false,\"description\":\"Velclaw identity service — JWT verification, sessions, API keys, audit\"}")

  if [ "$code" != "201" ]; then
    echo "Failed to create repo (HTTP ${code}):" >&2
    cat /tmp/gh-create.json >&2
    exit 1
  fi
  echo "Created ${OWNER}/${REPO}"
elif [ "$status" = "200" ]; then
  echo "Repo exists — will push into it."
else
  echo "Unexpected status ${status} for ${OWNER}/${REPO}" >&2
  exit 1
fi

# --- 2. Export source ----------------------------------------------------
if [ -e "$DEST" ]; then
  echo "Refusing to clobber ${DEST}. Remove it or set DEST=<path>." >&2
  exit 1
fi
bash "$(dirname "$0")/export.sh" "$DEST"
cd "$DEST"

# --- 3. Repo scaffolding -------------------------------------------------
cat > deno.json <<'JSON'
{
  "tasks": {
    "test": "deno run --allow-net --allow-env backend/jwt_test.ts",
    "check": "deno check index.ts backend/*.ts"
  },
  "imports": {
    "hono": "npm:hono"
  }
}
JSON

cat > .gitignore <<'TXT'
.env
.env.*
!.env.example
.deno/
deno.lock
node_modules/
dist/
build/
.DS_Store
.idea/
*.swp
TXT

# --- 4. Commit and push --------------------------------------------------
git init -b "$BRANCH" >/dev/null
git add -A

if git diff --cached --quiet; then
  echo "Nothing to commit." >&2
  exit 1
fi

git -c user.name="${GIT_NAME:-Velclaw Identity}" \
    -c user.email="${GIT_EMAIL:-noreply@velclaw.dev}" \
    commit -m "Velclaw Identity: auth service from Val Town" >/dev/null

# Push over HTTPS with the token supplied inline. `git -c http.extraheader`
# keeps the secret out of .git/config and out of the remote URL.
git -c "http.extraheader=Authorization: Bearer ${GH_TOKEN}" \
    push -u "https://github.com/${OWNER}/${REPO}.git" "$BRANCH"

echo
echo "Done → https://github.com/${OWNER}/${REPO}"
echo "Files: $(git ls-files | wc -l | tr -d ' ')"
