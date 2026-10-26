import { SignJWT, jwtVerify, importJWK, type JWK } from "npm:jose@5";

// Velclaw's Authentication/JWKS points at Neon Auth. Neon issues its own JWTs
// and publishes the public keys here, so we verify against that instead of
// trusting anything the client sends us.
export const DEFAULT_JWKS_URL =
  "https://ep-young-smoke-avkwn35p.neonauth.c-11.us-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json";

// Config is read on every call, not at module load: Val Town keeps a module
// instance warm, so a value captured at import time would go stale the moment
// someone sets an env var in the editor.
function env(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v && v.length > 0 ? v : undefined;
}

export function jwksUrl(): string {
  return env("VELCLAW_JWKS_URL") ?? DEFAULT_JWKS_URL;
}

/**
 * Explicit config, for callers (and tests) that must not go through env vars.
 * `Deno.env.set()` is a no-op on Val Town, so tests can't override env.
 */
export type JwkSource = { url: string } | { keys: JWK[] };

// Set by configureJwks(); falls back to the env var when unset.
let overrideSource: JwkSource | null = null;

export function configureJwks(source: JwkSource | null) {
  overrideSource = source;
  cache = null; // a new source must not reuse keys from the previous one
}

/** Algorithms we accept, derived from the key type rather than trusted from the token. */
function algFor(key: JWK): string {
  if (key.alg) return key.alg;
  switch (key.kty) {
    case "OKP": // Ed25519 — what Neon Auth publishes today
      return key.crv === "Ed448" ? "EdDSA" : "EdDSA";
    case "RSA":
      return "RS256";
    case "EC":
      return key.crv === "P-384"
        ? "ES384"
        : key.crv === "P-521"
        ? "ES512"
        : "ES256";
    default:
      throw new Error(`Unsupported JWKS key type: ${key.kty}`);
  }
}

const ALLOWED_ALGS = ["EdDSA", "RS256", "RS384", "RS512", "ES256", "ES384", "ES512"];

type Jwks = { keys: JWK[] };

// Keys rotate, so cache with a TTL rather than forever, and refetch when a
// `kid` we don't know shows up (see verify).
let cache: { keys: Jwks["keys"]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getJwks(force = false): Promise<Jwks> {
  // An explicitly configured key set bypasses the fetch entirely (tests).
  if (overrideSource && "keys" in overrideSource) {
    return { keys: overrideSource.keys };
  }

  const fresh = cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (cache && fresh && !force) return { keys: cache.keys };

  const url = overrideSource && "url" in overrideSource
    ? overrideSource.url
    : jwksUrl();

  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    // Serve a stale cache rather than locking everyone out on a transient blip.
    if (cache) return { keys: cache.keys };
    throw new Error(`Failed to fetch JWKS: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as Jwks;
  if (!Array.isArray(body?.keys)) throw new Error("Malformed JWKS document");

  // Only keep keys we can actually verify with, and only public material.
  const usable = body.keys.filter((k) =>
    k.kty === "OKP" || k.kty === "RSA" || k.kty === "EC"
  );
  if (usable.length === 0) throw new Error("JWKS contained no usable keys");

  cache = { keys: usable, fetchedAt: Date.now() };
  return { keys: usable };
}

async function keyFor(kid: string | undefined, force: boolean) {
  const { keys } = await getJwks(force);
  const match = kid ? keys.find((k) => k.kid === kid) : keys[0];
  if (!match) return null;
  return await importJWK(match, algFor(match)) as CryptoKey;
}

function decodeHeader(token: string): {
  kid?: string;
  alg?: string;
  typ?: string;
} {
  const [raw] = token.split(".");
  if (!raw) throw new Error("Malformed token");

  // base64url → padding for atob
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);

  try {
    return JSON.parse(atob(padded));
  } catch {
    throw new Error("Malformed token header");
  }
}

export type Identity = {
  sub: string;
  email: string | null;
  name: string | null;
  issuer: string | null;
  audience: string | string[] | null;
  expiresAt: number;
  claims: Record<string, unknown>;
};

/**
 * Verifies a Velclaw/Neon Auth JWT and returns the identity it asserts.
 * Throws on an invalid, expired, mismatched or unsigned token.
 */
export async function verifyJwt(token: string): Promise<Identity> {
  const header = decodeHeader(token);

  // Reject `alg: none` and anything outside our allowlist before touching keys.
  if (!header.alg || !ALLOWED_ALGS.includes(header.alg)) {
    throw new Error(`Disallowed JWT algorithm: ${header.alg ?? "(none)"}`);
  }

  let key = await keyFor(header.kid, false);
  // Unknown `kid` usually means the provider rotated keys: refetch once.
  if (!key) key = await keyFor(header.kid, true);
  if (!key) {
    throw new Error(`No matching JWKS key for kid=${header.kid ?? "(none)"}`);
  }

  const { payload } = await jwtVerify(token, key, {
    issuer: env("VELCLAW_JWT_ISSUER"),
    audience: env("VELCLAW_JWT_AUDIENCE"),
    // Pin the algorithm to the one we selected the key for, so a token can't
    // downgrade from EdDSA to a weaker algorithm.
    algorithms: [header.alg],
    // Neon tokens have no `exp` requirement issue; require presence when set.
    clockTolerance: 5,
  });

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("Token is missing a subject (sub) claim");
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    name: typeof payload.name === "string" ? payload.name : null,
    issuer: typeof payload.iss === "string" ? payload.iss : null,
    audience: (payload.aud as string | string[] | undefined) ?? null,
    expiresAt: (payload.exp ?? 0) * 1000,
    claims: payload as Record<string, unknown>,
  };
}

function accessSecret(explicit?: string): string {
  const secret = explicit ?? env("VELCLAW_IDENTITY_SECRET");
  if (!secret) throw new Error("VELCLAW_IDENTITY_SECRET is not set");
  return secret;
}

/** Mints a short-lived Velclaw access token (HS256) for service-to-service calls. */
export async function signAccessToken(
  identity: Pick<Identity, "sub" | "email">,
  ttlSeconds = 60 * 60,
  secretOverride?: string,
): Promise<string> {
  const secret = accessSecret(secretOverride);

  return await new SignJWT({ email: identity.email })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(identity.sub)
    .setIssuer("velclaw-identity")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(new TextEncoder().encode(secret));
}

/** Verifies a token minted by signAccessToken (used by downstream services). */
export async function verifyAccessToken(
  token: string,
  secretOverride?: string,
): Promise<Identity> {
  const secret = accessSecret(secretOverride);

  const { payload } = await jwtVerify(
    token,
    new TextEncoder().encode(secret),
    { issuer: "velclaw-identity", algorithms: ["HS256"] },
  );

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("Token is missing a subject (sub) claim");
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    name: null,
    issuer: "velclaw-identity",
    audience: null,
    expiresAt: (payload.exp ?? 0) * 1000,
    claims: payload as Record<string, unknown>,
  };
}
