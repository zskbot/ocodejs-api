// Audit log for identity events.
//
// Every login, logout, key creation and verification failure lands here so an
// operator can answer "who got in, when, and how" without reading console logs
// (which Val Town only keeps for a short window).
//
// Writes are fire-and-forget: an audit failure must never break the request it
// is recording. Reads are admin-gated (see index.ts).

import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";

export type AuditEvent =
  | "login.success"
  | "login.failure"
  | "logout"
  | "session.expired"
  | "verify.success"
  | "verify.failure"
  | "apikey.created"
  | "apikey.revoked"
  | "ratelimit.blocked";

export async function ensureAuditSchema() {
  await sqlite.batch([
    `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      event TEXT NOT NULL,
      identity_id TEXT,
      provider TEXT,
      detail TEXT,
      ip TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS audit_at ON audit_log (at DESC)`,
    `CREATE INDEX IF NOT EXISTS audit_event ON audit_log (event, at DESC)`,
  ]);
}

export type AuditInput = {
  event: AuditEvent;
  identityId?: string | null;
  provider?: string | null;
  detail?: string | null;
  ip?: string | null;
};

/** Records an event. Never throws, never awaited by callers that don't care. */
export function audit(input: AuditInput): Promise<void> {
  // Trim detail so a malformed JWT can't blow up the row size.
  const detail = input.detail ? String(input.detail).slice(0, 500) : null;

  return sqlite.execute({
    sql: `INSERT INTO audit_log (at, event, identity_id, provider, detail, ip)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      Date.now(),
      input.event,
      input.identityId ?? null,
      input.provider ?? null,
      detail,
      input.ip ?? null,
    ],
  }).then(() => {}).catch(() => {});
}

export type AuditRow = {
  id: number;
  at: number;
  event: string;
  identity_id: string | null;
  provider: string | null;
  detail: string | null;
  ip: string | null;
};

export async function recentAudit(
  limit = 50,
  event?: string,
): Promise<AuditRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200);

  const res = event
    ? await sqlite.execute({
      sql: "SELECT * FROM audit_log WHERE event = ? ORDER BY id DESC LIMIT ?",
      args: [event, capped],
    })
    : await sqlite.execute({
      sql: "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?",
      args: [capped],
    });

  return res.rows as unknown as AuditRow[];
}

/** Per-event counts over the last `days`, for the dashboard. */
export async function auditSummary(days = 7) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const res = await sqlite.execute({
    sql: `SELECT event, COUNT(*) AS count
          FROM audit_log
          WHERE at >= ?
          GROUP BY event
          ORDER BY count DESC`,
    args: [since],
  });

  return res.rows as unknown as { event: string; count: number }[];
}

/** Housekeeping: keep 90 days. */
export async function pruneAudit(): Promise<number> {
  const res = await sqlite.execute({
    sql: "DELETE FROM audit_log WHERE at < ?",
    args: [Date.now() - 90 * 24 * 60 * 60 * 1000],
  });
  return res.rowsAffected;
}

/** Extracts a client IP from forwarded headers, tolerating any absence. */
export function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}
