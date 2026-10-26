#!/usr/bin/env bash
# Export this val's source into a flat directory ready to `git push`.
#
# Val Town keeps the canonical copy; this script reconstructs a repo tree from
# it so the same code can live on GitHub. Run it from anywhere — it writes to
# ./velclaw-identity-export/.
#
# Usage:
#   bash scripts/export.sh [dest]
#
# Then:
#   cd velclaw-identity-export
#   git init && git add -A && git commit -m "Initial import from Val Town"
#   git remote add origin git@github.com:<owner>/<repo>.git
#   git push -u origin main

set -euo pipefail

DEST="${1:-velclaw-identity-export}"
VAL="ocodejs/velclaw-identity"
BASE="https://esm.town/v/${VAL}"

FILES=(
  "index.ts"
  "README.md"
  "backend/apikeys.ts"
  "backend/audit.ts"
  "backend/ecosystem.ts"
  "backend/jwks.ts"
  "backend/jwt_test.ts"
  "backend/oauth.ts"
  "backend/openapi.ts"
  "backend/skills.ts"
  "backend/store.ts"
  "backend/valtown.ts"
  "public/app.js"
  "public/dashboard.js"
  "public/docs.js"
  "public/dashboard.html"
  "public/docs.html"
  "public/index.html"
  "public/ocodejs-logo.svg"
  "public/theme.css"
)

mkdir -p "$DEST"
cd "$DEST"

echo "Exporting ${VAL} → $(pwd)"

for f in "${FILES[@]}"; do
  mkdir -p "$(dirname "$f")"
  # -f so a 404 on a renamed file fails loudly instead of writing HTML.
  if curl -fsSL "${BASE}/${f}" -o "$f"; then
    printf '  ✓ %s\n' "$f"
  else
    printf '  ✗ %s (missing or not fetchable)\n' "$f" >&2
    exit 1
  fi
done

# Val Town serves a banner comment at the top of some files; strip it.
echo "Stripping Val Town banners…"
find . -name '*.ts' -o -name '*.js' | while read -r f; do
  if head -n1 "$f" | grep -q '^/\* Open in Val Town:'; then
    tail -n +2 "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done

echo "Done. $(find . -type f | wc -l | tr -d ' ') files."
