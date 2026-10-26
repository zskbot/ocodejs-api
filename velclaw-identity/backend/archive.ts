// Build a ZIP of this val's source, on demand.
//
// Val Town has no "download val" endpoint, so this endpoint reassembles the
// tree into a zip in memory. Files are read through `readFile` from std/utils,
// which is the only supported way to read project files at runtime.
//
// The archive is generated per request (no caching) so it always matches the
// running version. Nothing secret is included: no .env, no database.

import {
  BlobReader,
  BlobWriter,
  TextReader,
  ZipWriter,
} from "https://esm.sh/@zip.js/zip.js@2.7.52/index.js";
import { readFile } from "https://esm.town/v/std/utils/index.ts";

/** Every source file that belongs in the archive. */
const FILES = [
  "index.ts",
  "README.md",
  "backend/apikeys.ts",
  "backend/archive.ts",
  "backend/audit.ts",
  "backend/ecosystem.ts",
  "backend/jwks.ts",
  "backend/jwt_test.ts",
  "backend/oauth.ts",
  "backend/openapi.ts",
  "backend/skills.ts",
  "backend/store.ts",
  "backend/valtown.ts",
  "public/app.js",
  "public/dashboard.js",
  "public/docs.js",
  "public/dashboard.html",
  "public/docs.html",
  "public/index.html",
  "public/ocodejs-logo.svg",
  "public/theme.css",
  "scripts/download-zip.sh",
  "scripts/export.sh",
  "scripts/publish.sh",
  "scripts/push-to-github.sh",
];

/** Extra repo scaffolding that doesn't live as a val file. */
const GENERATED: Record<string, string> = {
  "deno.json": JSON.stringify(
    {
      tasks: {
        test: "deno run --allow-net --allow-env backend/jwt_test.ts",
        check: "deno check index.ts backend/*.ts",
      },
      imports: { hono: "npm:hono" },
    },
    null,
    2,
  ) + "\n",
  ".gitignore": [
    ".env",
    ".env.*",
    "!.env.example",
    ".deno/",
    "deno.lock",
    "node_modules/",
    "dist/",
    "build/",
    ".DS_Store",
    ".idea/",
    "*.swp",
    "",
  ].join("\n"),
  ".env.example": [
    "# Velclaw Identity — environment variables. Never commit real values.",
    "",
    "# Velclaw OAuth (optional; without it the val uses Val Town login)",
    "VELCLAW_OAUTH_CLIENT_ID=",
    "VELCLAW_OAUTH_CLIENT_SECRET=",
    "VELCLAW_OAUTH_REDIRECT_URI=",
    "VELCLAW_OAUTH_AUTHORIZE_URL=https://velclaw.dev/auth/authorize",
    "VELCLAW_OAUTH_TOKEN_URL=https://velclaw.dev/auth/token",
    "VELCLAW_OAUTH_USERINFO_URL=https://velclaw.dev/auth/userinfo",
    "VELCLAW_OAUTH_SCOPES=openid email profile offline_access",
    "",
    "# JWT verification",
    "VELCLAW_JWKS_URL=",
    "VELCLAW_JWT_ISSUER=",
    "VELCLAW_JWT_AUDIENCE=",
    "",
    "# Tokens (POST /api/token)",
    "VELCLAW_IDENTITY_SECRET=",
    "",
    "# Admin (comma-separated handles allowed into /dashboard)",
    "VELCLAW_ADMIN_HANDLES=",
    "",
  ].join("\n"),
};

/**
 * Strips the `/* Open in Val Town: … *\/` banner that esm.town prepends, so
 * the archive looks like a plain repo rather than a Val Town export.
 */
function stripBanner(source: string): string {
  const firstLine = source.split("\n", 1)[0] ?? "";
  if (!firstLine.startsWith("/* Open in Val Town:")) return source;
  const idx = source.indexOf("\n");
  return idx === -1 ? "" : source.slice(idx + 1);
}

export type ArchiveResult = {
  zip: Uint8Array;
  included: string[];
  skipped: string[];
};

export async function buildArchive(): Promise<ArchiveResult> {
  const zipWriter = new ZipWriter(new BlobWriter("application/zip"));
  const included: string[] = [];
  const skipped: string[] = [];

  for (const path of FILES) {
    try {
      const raw = await readFile(`/${path}`);
      const isText = /\.(ts|js|json|md|html|css|svg|sh)$/.test(path);
      const content = isText ? stripBanner(raw) : raw;

      // The zip writer wants a Reader; text and binary take different ones.
      await zipWriter.add(
        path,
        isText ? new TextReader(content) : new BlobReader(new Blob([content])),
      );
      included.push(path);
    } catch {
      // A missing optional file shouldn't kill the whole archive.
      skipped.push(path);
    }
  }

  for (const [path, content] of Object.entries(GENERATED)) {
    await zipWriter.add(path, new TextReader(content));
    included.push(path);
  }

  const blob = await zipWriter.close();
  const zip = new Uint8Array(await blob.arrayBuffer());

  return { zip, included, skipped };
}
