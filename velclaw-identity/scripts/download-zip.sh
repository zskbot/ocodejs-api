#!/usr/bin/env bash
# Download the whole val as a zip / tarball.
#
# The zip is built locally from the files served by esm.town — Val Town has no
# "download val as archive" endpoint, so this reassembles the tree.
#
# Usage:
#   bash scripts/download-zip.sh              # → velclaw-identity.zip
#   FORMAT=tar bash scripts/download-zip.sh   # → velclaw-identity.tar.gz
#
# Requirements: curl, and either `zip` or `tar`.

set -euo pipefail

VAL="ocodejs/velclaw-identity"
BASE="https://esm.town/v/${VAL}"
NAME="velclaw-identity"
FORMAT="${FORMAT:-zip}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FILES=(
  "index.ts"
  "README.md"
  "deno.json"
  ".gitignore"
  ".env.example"
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
  "scripts/export.sh"
  "scripts/publish.sh"
  "scripts/push-to-github.sh"
)

echo "Downloading ${#FILES[@]} files from ${VAL}…"
mkdir -p "$WORK/$NAME"

ok=0
fail=0
for f in "${FILES[@]}"; do
  mkdir -p "$WORK/$NAME/$(dirname "$f")"
  if curl -fsSL "${BASE}/${f}" -o "$WORK/$NAME/$f"; then
    ok=$((ok + 1))
  else
    # Not fatal: a file may legitimately not exist (e.g. optional scripts).
    echo "  skip ${f}" >&2
    fail=$((fail + 1))
    rm -f "$WORK/$NAME/$f"
  fi
done

# Strip the Val Town banner so the archive looks like a normal repo.
cd "$WORK/$NAME"
find . -type f \( -name '*.ts' -o -name '*.js' \) | while read -r f; do
  if head -n1 "$f" | grep -q '^/\* Open in Val Town:'; then
    tail -n +2 "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done

if [ "$FORMAT" = "tar" ]; then
  OUT="$(pwd)/../../${NAME}.tar.gz"
  tar -czf "$OUT" -C "$WORK" "$NAME"
else
  OUT="$(pwd)/../../${NAME}.zip"
  if ! command -v zip >/dev/null 2>&1; then
    echo "zip not found — falling back to tar.gz" >&2
    OUT="$(pwd)/../../${NAME}.tar.gz"
    tar -czf "$OUT" -C "$WORK" "$NAME"
  else
    zip -qr "$OUT" .
  fi
fi

echo
echo "Wrote ${ok} files (${fail} skipped)"
echo "→ ${OUT}"
