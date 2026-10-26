import { Hono } from "npm:hono";
import { parseVal, serveFile } from "https://esm.town/v/std/utils/index.ts";
import {
  ANON_LIMIT,
  ensureApiKeySchema,
  KEYED_LIMIT,
  createApiKey,
  listApiKeys,
  pruneRateLimits,
  rateLimit,
  resolveApiKey,
  revokeApiKey,
  touchApiKey,
} from "./backend/apikeys.ts";
import {
  audit,
  auditSummary,
  clientIp,
  ensureAuditSchema,
  pruneAudit,
  recentAudit,
} from "./backend/audit.ts";
import { ecosystem } from "./backend/ecosystem.ts";
import { buildArchive } from "./backend/archive.ts";
import { getJwks, jwksUrl, signAccessToken, verifyJwt } from "./backend/jwks.ts";
import { openApiDocument } from "./backend/openapi.ts";
import * as oauth from "./backend/oauth.ts";
import { SKILLS, SKILL_CATEGORIES, skillCatalog } from "./backend/skills.ts";
import {
  valtownAuthorizeUrl,
  valtownExchange,
  valtownIdentityId,
} from "./backend/valtown.ts";
import {
  createSession,
  ensureSchema,
  findSession,
  pruneSessions,
  revokeSession,
  SESSION_TTL_MS,
  upsertIdentity,
} from "./backend/store.ts";

// Create tables on first run. All idempotent (CREATE TABLE IF NOT EXISTS).
await ensureSchema();
await ensureApiKeySchema();
await ensureAuditSchema();

const SESSION_COOKIE = "velclaw_session";
const STATE_COOKIE = "velclaw_oauth_state";
const VERIFIER_COOKIE = "velclaw_oauth_verifier";
const PROVIDER_COOKIE = "velclaw_oauth_provider";
const FLOW_TTL_SECONDS = 600; // 10 minutes to finish a login

const app = new Hono();

// --- helpers -------------------------------------------------------------

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function cookie(
  name: string,
  value: string,
  opts: { maxAge?: number; path?: string; sameSite?: string } = {},
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? "/"}`,
  ];
  parts.push("HttpOnly");
  parts.push("Secure");
  parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function appendCookies(res: Response, cookies: string[]): Response {
  const out = new Response(res.body, res);
  for (const c of cookies) out.headers.append("set-cookie", c);
  return out;
}

function clientMeta(req: Request) {
  return { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? null };
}

/**
 * Admin gate.
 *
 * There is no admin user table — the only trustworthy signal is "is this the
 * val's own org?", which Val Town already answers during the Val Town login.
 * We additionally require an explicit allowlist env var so that simply being a
 * Val Town user is not enough to read the audit log.
 */
function adminHandles(): string[] {
  const raw = Deno.env.get("VELCLAW_ADMIN_HANDLES") ?? "";
  return raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
}

async function requireAdmin(
  c: { req: { raw: Request; header: (k: string) => string | undefined } },
): Promise<Response | null> {
  const allowed = adminHandles();

  // API key with admin naming is not a thing — keys are read-only consumers.
  // Admin requires a logged-in identity whose name is in the allowlist.
  const session = await currentSession(c.req.raw);
  if (!session) {
    return Response.json({ error: "Admin login required" }, { status: 401 });
  }

  const name = (session.name ?? "").toLowerCase();
  const email = (session.email ?? "").toLowerCase();

  const ok = allowed.some((h) => h === name || h === email);
  if (!ok) {
    return Response.json(
      {
        error: "Not an admin",
        hint: "Set VELCLAW_ADMIN_HANDLES to a comma-separated allowlist.",
      },
      { status: 403 },
    );
  }

  return null;
}

// --- session / identity --------------------------------------------------

async function currentSession(req: Request) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  return await findSession(token);
}

/**
 * Resolves the caller from our own session cookie.
 *
 * Both login flows end by minting this same session, so there is exactly one
 * notion of "logged in" regardless of how the user got here.
 */
async function resolveIdentity(req: Request) {
  const session = await currentSession(req);
  if (!session) return null;
  return {
    id: session.identity_id,
    email: session.email,
    name: session.name,
    issuer: session.issuer,
  };
}

/** Completes any login flow: mirror the identity, mint a session, set the cookie. */
async function finishLogin(
  req: Request,
  input: {
    id: string;
    email: string | null;
    name: string | null;
    issuer: string;
  },
): Promise<Response> {
  const identity = await upsertIdentity(input);
  const { token } = await createSession({
    identityId: identity.id,
    ...clientMeta(req),
  });

  audit({
    event: "login.success",
    identityId: identity.id,
    provider: input.issuer,
    ip: clientIp(req),
  });

  return appendCookies(
    new Response(null, { status: 302, headers: { Location: "/" } }),
    [
      cookie(SESSION_COOKIE, token, {
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
        sameSite: "Lax",
      }),
      clearCookie(STATE_COOKIE),
      clearCookie(VERIFIER_COOKIE),
      clearCookie(PROVIDER_COOKIE),
    ],
  );
}

// --- rate limiting middleware -------------------------------------------

/**
 * Applies a per-caller limit to the API surface.
 *
 * A valid API key raises the ceiling and identifies the consumer; without one
 * the bucket is the client IP. Failure mode is deliberately open (see
 * rateLimit) — the limiter must not become an outage.
 */
async function applyRateLimit(
  req: Request,
): Promise<{ res: Response | null; keyName: string | null }> {
  const presented = req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  let bucket: string;
  let limit: number;
  let keyName: string | null = null;

  if (presented && presented.startsWith("vci_")) {
    const row = await resolveApiKey(presented);
    if (!row) {
      return {
        res: Response.json({ error: "Invalid or revoked API key" }, {
          status: 401,
        }),
        keyName: null,
      };
    }
    bucket = `key:${row.id}`;
    limit = KEYED_LIMIT;
    keyName = row.name;
    touchApiKey(row.id);
  } else {
    bucket = `ip:${clientIp(req) ?? "unknown"}`;
    limit = ANON_LIMIT;
  }

  const result = await rateLimit(bucket, limit);

  if (!result.ok) {
    audit({
      event: "ratelimit.blocked",
      detail: bucket,
      ip: clientIp(req),
    });
    return {
      res: Response.json(
        {
          error: "Rate limit exceeded",
          limit: result.limit,
          resetAt: result.resetAt,
          hint: "Gửi header X-API-Key để có hạn mức cao hơn.",
        },
        {
          status: 429,
          headers: {
            "retry-after": String(
              Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)),
            ),
            "x-ratelimit-limit": String(result.limit),
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(result.resetAt),
          },
        },
      ),
      keyName,
    };
  }

  return { res: null, keyName };
}

// --- routes: pages -------------------------------------------------------

app.get("/", (c) => serveFile("/public/index.html"));
app.get("/public/*", (c) => serveFile(c.req.path));
app.get("/docs", (c) => serveFile("/public/docs.html"));
app.get("/dashboard", (c) => serveFile("/public/dashboard.html"));
app.get("/source", (c) => c.redirect(parseVal().links.self.val));

// --- routes: meta --------------------------------------------------------

app.get("/api/health", async (c) => {
  let jwksOk = true;
  let jwksError: string | null = null;
  try {
    const { keys } = await getJwks();
    jwksOk = keys.length > 0;
  } catch (err) {
    jwksOk = false;
    jwksError = err instanceof Error ? err.message : String(err);
  }

  const configured = oauth.isConfigured();

  return c.json(
    {
      ok: jwksOk,
      provider: configured ? "velclaw" : "valtown",
      version: "1.1.0",
      oauth: { configured },
      jwks: { url: jwksUrl(), ok: jwksOk, error: jwksError },
      capabilities: {
        apiKeys: true,
        auditLog: true,
        rateLimit: { anonymous: ANON_LIMIT, keyed: KEYED_LIMIT },
        ecosystem: true,
      },
    },
    jwksOk ? 200 : 503,
  );
});

/** Proxy/mirror of the upstream JWKS, so other services can pin one URL. */
app.get("/.well-known/jwks.json", async (c) => {
  const jwks = await getJwks();
  return c.json(jwks, 200, { "cache-control": "public, max-age=600" });
});

app.get("/api/openapi.json", (c) => {
  return c.json(openApiDocument(new URL(c.req.url).origin), 200, {
    // Short cache: the spec changes whenever a route changes, and a stale
    // 10-minute edge cache made newly added paths invisible after a deploy.
    "cache-control": "public, max-age=60",
  });
});

/** Ecosystem registry, shaped like docs-ocodejs `ecosystem/repositories.json`. */
app.get("/api/ecosystem.json", (c) => {
  return c.json(ecosystem(), 200, { "cache-control": "public, max-age=600" });
});

/**
 * Download the whole val as a zip, ready to `git push`.
 *
 * Built per request rather than cached: the archive must always match the
 * running version, and it's small enough that rebuilding is cheap.
 */
app.get("/download.zip", async (c) => {
  const { zip, included, skipped } = await buildArchive();

  if (skipped.length > 0) {
    console.warn(`archive: skipped ${skipped.join(", ")}`);
  }

  const zipBuffer = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
  return new Response(zipBuffer, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="velclaw-identity.zip"',
      "cache-control": "no-store",
      "x-files-included": String(included.length),
    },
  });
});

// --- routes: auth --------------------------------------------------------

// Two providers share the /auth/callback path (Val Town pins that path in its
// SDK). The `provider` cookie tells the callback which flow it's finishing.
app.get("/auth/login", async (c) => {
  if (!oauth.isConfigured()) {
    const url = await valtownAuthorizeUrl(c.req.raw);
    return appendCookies(c.redirect(url), [
      cookie(PROVIDER_COOKIE, "valtown", { maxAge: FLOW_TTL_SECONDS }),
    ]);
  }

  const state = oauth.randomState();
  const { verifier, challenge } = await oauth.createPkcePair();
  const url = oauth.buildAuthorizeUrl({ state, codeChallenge: challenge });

  return appendCookies(c.redirect(url), [
    cookie(STATE_COOKIE, state, { maxAge: FLOW_TTL_SECONDS }),
    cookie(VERIFIER_COOKIE, verifier, { maxAge: FLOW_TTL_SECONDS }),
    cookie(PROVIDER_COOKIE, "velclaw", { maxAge: FLOW_TTL_SECONDS }),
  ]);
});

app.get("/auth/callback", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  if (providerError) {
    audit({
      event: "login.failure",
      detail: providerError,
      ip: clientIp(c.req.raw),
    });
    return c.redirect(`/?error=${encodeURIComponent(providerError)}`);
  }
  if (!code || !state) {
    return c.redirect("/?error=missing_code_or_state");
  }

  const provider = readCookie(c.req.raw, PROVIDER_COOKIE);

  // --- Val Town ---
  if (provider === "valtown") {
    try {
      const { profile } = await valtownExchange(c.req.raw, code, state);
      return await finishLogin(c.req.raw, {
        id: valtownIdentityId(profile),
        email: profile.email,
        name: profile.username,
        issuer: "valtown",
      });
    } catch (err) {
      audit({
        event: "login.failure",
        provider: "valtown",
        detail: err instanceof Error ? err.message : String(err),
        ip: clientIp(c.req.raw),
      });
      return c.redirect("/?error=valtown_exchange_failed");
    }
  }

  // --- Velclaw OAuth ---
  const expectedState = readCookie(c.req.raw, STATE_COOKIE);
  const verifier = readCookie(c.req.raw, VERIFIER_COOKIE);

  if (!expectedState || !verifier) {
    return c.redirect("/?error=missing_flow_state");
  }
  if (state !== expectedState) {
    audit({
      event: "login.failure",
      provider: "velclaw",
      detail: "state mismatch",
      ip: clientIp(c.req.raw),
    });
    return c.redirect("/?error=state_mismatch");
  }

  try {
    const tokens = await oauth.exchangeCode({ code, codeVerifier: verifier });
    const info = await oauth.fetchUserInfo(tokens.access_token);

    let sub = info.sub;
    let issuer = "velclaw";
    if (tokens.id_token) {
      const verified = await verifyJwt(tokens.id_token);
      sub = verified.sub;
      issuer = verified.issuer ?? issuer;
    }
    if (!sub) throw new Error("Provider returned no subject identifier");

    return await finishLogin(c.req.raw, {
      id: sub,
      email: info.email ?? null,
      name: info.name ?? null,
      issuer,
    });
  } catch (err) {
    audit({
      event: "login.failure",
      provider: "velclaw",
      detail: err instanceof Error ? err.message : String(err),
      ip: clientIp(c.req.raw),
    });
    return c.redirect("/?error=velclaw_exchange_failed");
  }
});

app.post("/auth/logout", async (c) => {
  const token = readCookie(c.req.raw, SESSION_COOKIE);
  if (token) {
    const session = await findSession(token);
    await revokeSession(token);
    audit({
      event: "logout",
      identityId: session?.identity_id ?? null,
      ip: clientIp(c.req.raw),
    });
  }
  return appendCookies(c.json({ ok: true }), [clearCookie(SESSION_COOKIE)]);
});

// --- routes: identity ----------------------------------------------------

app.get("/api/me", async (c) => {
  const identity = await resolveIdentity(c.req.raw);
  if (!identity) return c.json({ error: "Not authenticated" }, 401);
  return c.json({ user: identity });
});

// --- routes: tokens (rate limited) --------------------------------------

app.post("/api/verify", async (c) => {
  const limited = await applyRateLimit(c.req.raw);
  if (limited.res) return limited.res;

  let token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");

  if (!token) {
    try {
      const body = await c.req.json<{ token?: string }>();
      token = body.token;
    } catch {
      // no JSON body — fall through
    }
  }

  if (!token) return c.json({ error: "Missing token" }, 400);

  try {
    const identity = await verifyJwt(token);
    audit({
      event: "verify.success",
      identityId: identity.sub,
      provider: identity.issuer,
      ip: clientIp(c.req.raw),
    });
    return c.json({ valid: true, identity });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    audit({
      event: "verify.failure",
      detail: message,
      ip: clientIp(c.req.raw),
    });
    return c.json({ valid: false, error: "Invalid or unverifiable token" }, 401);
  }
});

app.post("/api/token", async (c) => {
  const identity = await resolveIdentity(c.req.raw);
  if (!identity) return c.json({ error: "Not authenticated" }, 401);

  try {
    const token = await signAccessToken({
      sub: identity.id,
      email: identity.email,
    });
    return c.json({ token, expiresIn: 3600 });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

// --- routes: skills ------------------------------------------------------

app.get("/api/skills.json", (c) => {
  const category = c.req.query("category");
  const q = c.req.query("q")?.trim().toLowerCase();

  if (category && !SKILL_CATEGORIES.some((cat) => cat.id === category)) {
    return c.json(
      {
        error: "Unknown category",
        valid: SKILL_CATEGORIES.map((cat) => cat.id),
      },
      400,
    );
  }

  const skills = SKILLS.filter((skill) => {
    if (category && skill.category !== category) return false;
    if (!q) return true;
    return (
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q)
    );
  });

  const base = skillCatalog();
  return c.json(
    {
      ...base,
      skills,
      counts: { ...base.counts, skills: skills.length },
    },
    200,
    { "cache-control": "public, max-age=600" },
  );
});

// --- routes: admin (gated) ----------------------------------------------

app.get("/api/admin/stats", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const [keys, summary, events] = await Promise.all([
    listApiKeys(),
    auditSummary(7),
    recentAudit(20),
  ]);

  return c.json({
    apiKeys: {
      total: keys.length,
      active: keys.filter((k) => k.revoked_at === null).length,
    },
    audit: { last7Days: summary, recent: events },
    capabilities: {
      rateLimit: { anonymous: ANON_LIMIT, keyed: KEYED_LIMIT },
    },
  });
});

/** Read the audit trail. `?event=` filters, `?limit=` caps at 200. */
app.get("/api/admin/audit", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const limit = Number(c.req.query("limit") ?? 50);
  const event = c.req.query("event") ?? undefined;

  return c.json({
    events: await recentAudit(Number.isFinite(limit) ? limit : 50, event),
  });
});

/** Issue a key. The plaintext appears in this response and nowhere else. */
app.post("/api/admin/keys", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  let name = "unnamed";
  try {
    const body = await c.req.json<{ name?: string }>();
    if (body.name) name = String(body.name).slice(0, 80);
  } catch {
    // no body — keep the default name
  }

  const created = await createApiKey(name);

  audit({
    event: "apikey.created",
    detail: `${name} (${created.prefix}…)`,
    ip: clientIp(c.req.raw),
  });

  return c.json(
    {
      key: created.key,
      id: created.id,
      prefix: created.prefix,
      note: "Lưu key này ngay — nó không hiển thị lại lần nữa.",
    },
    201,
  );
});

app.get("/api/admin/keys", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const keys = await listApiKeys();
  // Never leak hashes.
  return c.json({
    keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      createdAt: k.created_at,
      lastUsedAt: k.last_used_at,
      revokedAt: k.revoked_at,
      requestCount: k.request_count,
    })),
  });
});

app.delete("/api/admin/keys/:id", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const id = c.req.param("id");
  const revoked = await revokeApiKey(id);

  if (!revoked) return c.json({ error: "Key not found or already revoked" }, 404);

  audit({ event: "apikey.revoked", detail: id, ip: clientIp(c.req.raw) });
  return c.json({ ok: true, id });
});

// Unwrap and rethrow Hono errors as the original error so we get real stack traces.
// Keep internal exception details in server logs, not in public API responses.
app.onError((err, c) => {
  console.error("Unhandled request error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// Housekeeping without blocking the response.
pruneSessions().catch(() => {});
pruneRateLimits().catch(() => {});
pruneAudit().catch(() => {});

export default app.fetch;
