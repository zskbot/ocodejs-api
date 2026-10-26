import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";

// Velclaw identity storage. One row per external identity (keyed by the JWT
// `sub`), and one row per active session.
//
// Sessions are stored server-side rather than as a signed stateless cookie so a
// logout actually revokes access, and so a user's sessions can be listed or
// killed from the admin surface.
export async function ensureSchema() {
  await sqlite.batch([
    `CREATE TABLE IF NOT EXISTS identities (
      id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      issuer TEXT,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      ip TEXT,
      user_agent TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS sessions_identity
       ON sessions (identity_id)`,
    `CREATE INDEX IF NOT EXISTS sessions_expiry
       ON sessions (expires_at)`,
  ]);
}

export type IdentityRow = {
  id: string;
  email: string | null;
  name: string | null;
  issuer: string | null;
  created_at: number;
  last_seen_at: number;
};

/** Inserts the identity on first login, and refreshes profile fields after. */
export async function upsertIdentity(input: {
  id: string;
  email: string | null;
  name: string | null;
  issuer: string | null;
}): Promise<IdentityRow> {
  const now = Date.now();
  await sqlite.execute({
    sql: `INSERT INTO identities (id, email, name, issuer, created_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            email = COALESCE(excluded.email, identities.email),
            name = COALESCE(excluded.name, identities.name),
            issuer = COALESCE(excluded.issuer, identities.issuer),
            last_seen_at = excluded.last_seen_at`,
    args: [input.id, input.email, input.name, input.issuer, now, now],
  });

  const res = await sqlite.execute({
    sql: "SELECT * FROM identities WHERE id = ?",
    args: [input.id],
  });
  return res.rows[0] as unknown as IdentityRow;
}

export async function getIdentity(id: string): Promise<IdentityRow | null> {
  const res = await sqlite.execute({
    sql: "SELECT * FROM identities WHERE id = ?",
    args: [id],
  });
  return (res.rows[0] as unknown as IdentityRow) ?? null;
}

// --- sessions ------------------------------------------------------------

/** 32 random bytes, base64url. The raw value only ever exists in the cookie. */
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Sessions are indexed by hash, so a database leak doesn't yield live cookies. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createSession(input: {
  identityId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; expiresAt: number }> {
  const token = newSessionToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  await sqlite.execute({
    sql: `INSERT INTO sessions
            (id, identity_id, token_hash, created_at, expires_at, ip, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      input.identityId,
      tokenHash,
      now,
      expiresAt,
      input.ip ?? null,
      input.userAgent ?? null,
    ],
  });

  return { token, expiresAt };
}

export async function findSession(token: string) {
  const tokenHash = await hashToken(token);
  const res = await sqlite.execute({
    sql: `SELECT s.id, s.identity_id, s.expires_at, s.revoked_at,
                 i.email, i.name, i.issuer
          FROM sessions s
          JOIN identities i ON i.id = s.identity_id
          WHERE s.token_hash = ?`,
    args: [tokenHash],
  });

  const row = res.rows[0] as unknown as
    | {
      id: string;
      identity_id: string;
      expires_at: number;
      revoked_at: number | null;
      email: string | null;
      name: string | null;
      issuer: string | null;
    }
    | undefined;

  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (row.expires_at <= Date.now()) return null;
  return row;
}

export async function revokeSession(token: string): Promise<boolean> {
  const tokenHash = await hashToken(token);
  const res = await sqlite.execute({
    sql: "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
    args: [Date.now(), tokenHash],
  });
  return res.rowsAffected > 0;
}

/** Housekeeping: drop expired and revoked rows. Safe to call any time. */
export async function pruneSessions(): Promise<number> {
  const res = await sqlite.execute({
    sql: "DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL",
    args: [Date.now() - 7 * 24 * 60 * 60 * 1000],
  });
  return res.rowsAffected;
}
