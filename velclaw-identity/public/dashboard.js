// Admin dashboard. Server enforces the gate; this file only renders.

const gateEl = document.getElementById("gate");
const appEl = document.getElementById("app");
const statsEl = document.getElementById("stats");
const keyListEl = document.getElementById("key-list");
const keysCountEl = document.getElementById("keys-count");
const newKeyEl = document.getElementById("new-key");
const auditListEl = document.getElementById("audit-list");
const auditFilter = document.getElementById("audit-filter");
const keyForm = document.getElementById("key-form");
const keyNameInput = document.getElementById("key-name");
const refreshBtn = document.getElementById("refresh");

const FETCH_OPTS = { credentials: "include" };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function showGate(message, hint) {
  gateEl.hidden = false;
  gateEl.replaceChildren(el("strong", null, message));
  if (hint) gateEl.appendChild(el("span", null, " " + hint));
  appEl.hidden = true;
}

function fmtTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("vi-VN", { hour12: false });
}

function statCard(label, value) {
  const card = el("div", "stat");
  card.appendChild(el("span", "stat-value", String(value)));
  card.appendChild(el("span", "stat-label", label));
  return card;
}

// --- data loading --------------------------------------------------------

async function loadStats() {
  const res = await fetch("/api/admin/stats", FETCH_OPTS);
  if (!res.ok) return false;

  const data = await res.json();
  statsEl.replaceChildren();

  statsEl.appendChild(statCard("API key đang hoạt động", data.apiKeys.active));
  statsEl.appendChild(statCard("Tổng số key", data.apiKeys.total));
  statsEl.appendChild(
    statCard("Hạn mức ẩn danh / phút", data.capabilities.rateLimit.anonymous),
  );
  statsEl.appendChild(
    statCard("Hạn mức có key / phút", data.capabilities.rateLimit.keyed),
  );

  return true;
}

async function loadKeys() {
  const res = await fetch("/api/admin/keys", FETCH_OPTS);
  if (!res.ok) return;

  const { keys } = await res.json();
  keysCountEl.textContent = String(keys.length);

  keyListEl.replaceChildren();

  if (keys.length === 0) {
    keyListEl.appendChild(el("div", "row", "Chưa có key nào."));
    return;
  }

  for (const key of keys) {
    const row = el("div", "row");

    const name = el("div", "key-cell");
    name.appendChild(el("span", "path", key.name));
    name.appendChild(el("span", "mono", `${key.prefix}…`));
    row.appendChild(name);

    const meta = el("span", "row-note");
    meta.textContent = key.revokedAt
      ? `đã thu hồi ${fmtTime(key.revokedAt)}`
      : `${key.requestCount} request · dùng lần cuối ${fmtTime(key.lastUsedAt)}`;
    row.appendChild(meta);

    if (!key.revokedAt) {
      const btn = el("button", "btn btn-ghost btn-sm", "Thu hồi");
      btn.type = "button";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Đang thu hồi…";
        const r = await fetch(`/api/admin/keys/${key.id}`, {
          method: "DELETE",
          ...FETCH_OPTS,
        });
        if (!r.ok) {
          btn.textContent = "Lỗi";
          return;
        }
        await Promise.all([loadKeys(), loadStats(), loadAudit()]);
      });
      row.appendChild(btn);
    }

    keyListEl.appendChild(row);
  }
}

async function loadAudit() {
  const event = auditFilter.value;
  const qs = event ? `?event=${encodeURIComponent(event)}&limit=50` : "?limit=50";

  const res = await fetch(`/api/admin/audit${qs}`, FETCH_OPTS);
  if (!res.ok) return;

  const { events } = await res.json();
  auditListEl.replaceChildren();

  if (events.length === 0) {
    auditListEl.appendChild(el("div", "mono", "Chưa có sự kiện nào."));
    return;
  }

  for (const ev of events) {
    const row = el("div", "audit-row");

    const kind = ev.event.endsWith(".failure") || ev.event === "ratelimit.blocked"
      ? "pill pill-warn"
      : "pill pill-ok";
    row.appendChild(el("span", kind, ev.event));

    const who = ev.identity_id ?? ev.provider ?? "—";
    row.appendChild(el("span", "mono", who));

    if (ev.detail) {
      row.appendChild(el("span", "audit-detail", ev.detail));
    }

    row.appendChild(el("span", "audit-time", fmtTime(ev.at)));
    auditListEl.appendChild(row);
  }
}

// --- actions -------------------------------------------------------------

keyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = keyNameInput.value.trim() || "unnamed";

  const res = await fetch("/api/admin/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
    ...FETCH_OPTS,
  });

  if (!res.ok) {
    newKeyEl.hidden = false;
    newKeyEl.replaceChildren(el("div", "alert", "Không tạo được key."));
    return;
  }

  const created = await res.json();

  newKeyEl.hidden = false;
  newKeyEl.replaceChildren();

  const box = el("div", "notice");
  box.appendChild(el("strong", null, "Key mới — sao chép ngay:"));
  const code = el("pre", "code", created.key);
  code.style.marginTop = "8px";
  box.appendChild(code);
  box.appendChild(el("span", "mono", created.note));
  newKeyEl.appendChild(box);

  keyNameInput.value = "";
  await Promise.all([loadKeys(), loadStats(), loadAudit()]);
});

auditFilter.addEventListener("change", loadAudit);

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  await Promise.all([loadStats(), loadKeys(), loadAudit()]);
  refreshBtn.disabled = false;
});

// --- boot ----------------------------------------------------------------

async function boot() {
  const res = await fetch("/api/admin/stats", FETCH_OPTS);

  if (res.status === 401) {
    showGate(
      "Bạn chưa đăng nhập.",
      "Hãy đăng nhập trên trang chủ trước, rồi quay lại đây.",
    );
    return;
  }

  if (res.status === 403) {
    showGate(
      "Tài khoản này không có quyền admin.",
      "Thêm handle của bạn vào VELCLAW_ADMIN_HANDLES trong biến môi trường.",
    );
    return;
  }

  if (!res.ok) {
    showGate(`Lỗi ${res.status} khi tải dashboard.`);
    return;
  }

  appEl.hidden = false;
  await Promise.all([loadStats(), loadKeys(), loadAudit()]);
}

boot();
