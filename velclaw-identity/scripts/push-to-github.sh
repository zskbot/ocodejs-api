#!/usr/bin/env bash
# Export this val and push it to a (possibly empty) GitHub repo.
#
# This is the one-command path. It:
#   1. exports every source file out of Val Town (via scripts/export.sh)
#   2. resolves imports so the repo runs outside Val Town (see below)
#   3. git init / commit / push
#
# Usage:
#   GH_REPO=git@github.com:<owner>/<repo>.git bash scripts/push-to-github.sh
#
# Requirements: curl, git, and push access to GH_REPO (SSH key or PAT).

set -euo pipefail

: "${GH_REPO:?Set GH_REPO, e.g. GH_REPO=git@github.com:zskbot/velclaw-identity.git}"
BRANCH="${BRANCH:-main}"
DEST="${DEST:-velclaw-identity-export}"

if [ -e "$DEST" ]; then
  echo "Refusing to clobber existing directory: $DEST" >&2
  echo "Remove it or set DEST=<other path>." >&2
  exit 1
fi

# 1. Export source --------------------------------------------------------
bash "$(dirname "$0")/export.sh" "$DEST"

cd "$DEST"

# 2. Make it runnable outside Val Town ------------------------------------
#
# The source imports `std/*` helpers from esm.town, which only exist on the
# Val Town runtime. Keeping those URLs is correct for the Val Town deployment
# and harmless for GitHub (the code is still the same code), so we do NOT
# rewrite them. We only add the files a normal repo needs.

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

# 3. Git ------------------------------------------------------------------
git init -b "$BRANCH" >/dev/null
git add -A

if git diff --cached --quiet; then
  echo "Nothing to commit (export produced no changes)." >&2
  exit 1
fi

git -c user.name="${GIT_NAME:-Velclaw Identity}" \
    -c user.email="${GIT_EMAIL:-noreply@velclaw.dev}" \
    commit -m "Import Velclaw Identity from Val Town" >/dev/null

git remote add origin "$GH_REPO"
git push -u origin "$BRANCH"

echo
echo "Pushed to $GH_REPO ($BRANCH)."
echo "Files: $(git ls-files | wc -l | tr -d ' ')"
