// API keys and rate limiting.
//
// Why this exists: /api/verify is a public endpoint that does an outbound JWKS
// fetch (cached) plus crypto work. Without a per-caller limit, one script can
// hammer it. Keys are optional — the val still works anonymously — but issuing
// a key raises the rate limit and lets you revoke a specific consumer.
//
// Keys are stored hashed (SHA-256), same reasoning as session tokens: a database
// leak must not hand over usable credentials.

import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";

export async function ensureApiKeySchema() {
  await sqlite.batch([
    `CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked_at INTEGER,
      request_count INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS api_keys_hash ON api_keys (key_hash)`,
    // Sliding-window counters. One row per (bucket, window start).
    `CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket, window_start)
    )`,
  ]);
}

/** Anonymous callers: enough for a human, not for a loop. */
export const ANON_LIMIT = 30;
/** Keyed callers. */
export const KEYED_LIMIT = 600;
/** Window length in ms. */
export const WINDOW_MS = 60_000;

async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Creates a key. The plaintext is returned once and never stored. */
export async function createApiKey(
  name: string,
): Promise<{ key: string; id: string; prefix: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const secret = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const key = `vci_${secret}`; // vci = velclaw identity
  const prefix = key.slice(0, 12);
  const id = crypto.randomUUID();

  await sqlite.execute({
    sql: `INSERT INTO api_keys (id, name, key_hash, prefix, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, name, await hashKey(key), prefix, Date.now()],
  });

  return { key, id, prefix };
}

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  request_count: number;
};

/** Resolves a presented key, or null if unknown/revoked. */
export async function resolveApiKey(key: string): Promise<ApiKeyRow | null> {
  const row = (await sqlite.execute({
    sql: "SELECT * FROM api_keys WHERE key_hash = ?",
    args: [await hashKey(key)],
  })).rows[0] as unknown as ApiKeyRow | undefined;

  if (!row || row.revoked_at !== null) return null;
  return row;
}

/** Fire-and-forget bookkeeping: bump last-used and the request counter. */
export function touchApiKey(id: string) {
  sqlite.execute({
    sql: `UPDATE api_keys
          SET last_used_at = ?, request_count = request_count + 1
          WHERE id = ?`,
    args: [Date.now(), id],
  }).catch(() => {});
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const res = await sqlite.execute(
    "SELECT * FROM api_keys ORDER BY created_at DESC",
  );
  return res.rows as unknown as ApiKeyRow[];
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const res = await sqlite.execute({
    sql: "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    args: [Date.now(), id],
  });
  return res.rowsAffected > 0;
}

// --- rate limiting -------------------------------------------------------

export type RateResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  bucket: string;
};

/**
 * Fixed-window counter.
 *
 * A sliding window would be fairer at the boundary, but this is one indexed
 * upsert per request versus a range scan — the right trade for a counter whose
 * only job is to stop runaway loops, not to bill anyone.
 */
export async function rateLimit(
  bucket: string,
  limit: number,
): Promise<RateResult> {
  const now = Date.now();
  const windowStart = now - (now % WINDOW_MS);
  const resetAt = windowStart + WINDOW_MS;

  try {
    await sqlite.execute({
      sql: `INSERT INTO rate_limits (bucket, window_start, count)
            VALUES (?, ?, 1)
            ON CONFLICT(bucket, window_start)
            DO UPDATE SET count = count + 1`,
      args: [bucket, windowStart],
    });

    const row = (await sqlite.execute({
      sql: "SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?",
      args: [bucket, windowStart],
    })).rows[0] as unknown as { count: number } | undefined;

    const count = row?.count ?? 1;

    return {
      ok: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
      bucket,
    };
  } catch {
    // Never let the limiter itself take the endpoint down.
    return { ok: true, limit, remaining: limit, resetAt, bucket };
  }
}

/** Housekeeping: drop windows older than 10 minutes. */
export async function pruneRateLimits(): Promise<number> {
  const res = await sqlite.execute({
    sql: "DELETE FROM rate_limits WHERE window_start < ?",
    args: [Date.now() - 10 * 60_000],
  });
  return res.rowsAffected;
}
