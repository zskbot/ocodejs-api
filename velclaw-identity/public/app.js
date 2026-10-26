// Reflect live auth + service state on the landing page.
// Plain JS on purpose — no build step, no framework.

const sessionEl = document.getElementById("session");
const healthEl = document.getElementById("health");
const providerEl = document.getElementById("provider");
const sessionPill = document.getElementById("session-pill");
const sessionPillText = document.getElementById("session-pill-text");
const healthPill = document.getElementById("health-pill");
const healthPillText = document.getElementById("health-pill-text");

// Same-origin by default, but the page is reachable through the val.run
// subdomain; "include" sends cookies in both cases. The cookie is HttpOnly +
// SameSite=Lax, so nothing is exposed to script.
const FETCH_OPTS = { credentials: "include" };

/** Small DOM builder — keeps the tree readable without innerHTML. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setPill(pill, textNode, variant, label) {
  if (!pill || !textNode) return;
  pill.hidden = false;
  pill.className = `pill pill-${variant}`;
  textNode.textContent = label;
}

/** First grapheme of the display name, for the avatar. */
function initial(name) {
  const trimmed = (name ?? "").trim();
  return trimmed ? trimmed[0].toUpperCase() : "?";
}

async function loadSession() {
  const error = new URLSearchParams(location.search).get("error");

  try {
    const res = await fetch("/api/me", FETCH_OPTS);
    sessionEl.replaceChildren();

    if (res.ok) {
      const { user } = await res.json();
      const display = user.email ?? user.name ?? user.id;

      sessionEl.appendChild(el("div", "avatar", initial(display)));

      const identity = el("div", "identity");
      identity.appendChild(el("p", "identity-name", display));
      identity.appendChild(el("p", "mono", `id: ${user.id}`));
      if (user.issuer) {
        identity.appendChild(el("p", "mono", `issuer: ${user.issuer}`));
      }
      sessionEl.appendChild(identity);

      const btn = el("button", "btn btn-ghost", "Đăng xuất");
      btn.type = "button";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Đang đăng xuất…";
        await fetch("/auth/logout", { method: "POST", ...FETCH_OPTS });
        location.reload();
      });
      sessionEl.appendChild(btn);

      setPill(sessionPill, sessionPillText, "ok", "Đã đăng nhập");
      return;
    }

    // Signed out (or the cookie expired mid-session).
    setPill(sessionPill, sessionPillText, "warn", "Chưa đăng nhập");

    if (error) {
      sessionEl.appendChild(
        el("div", "alert", `Đăng nhập thất bại: ${error}`),
      );
    }

    // Label the button from the active provider so it never claims to be a
    // Velclaw login when Val Town is the one configured.
    const health = await fetch("/api/health")
      .then((r) => r.json())
      .catch(() => null);
    const providerName = health?.provider === "velclaw" ? "Velclaw" : "Val Town";

    const link = el("a", "btn btn-primary", `Đăng nhập với ${providerName}`);
    link.href = "/auth/login";
    sessionEl.appendChild(link);
  } catch (err) {
    sessionEl.replaceChildren();
    sessionEl.appendChild(
      el("div", "alert", `Không gọi được /api/me: ${err.message}`),
    );
  }
}

async function loadHealth() {
  try {
    const res = await fetch("/api/health");
    const body = await res.json();

    healthEl.textContent = JSON.stringify(body, null, 2);

    if (providerEl) {
      providerEl.textContent = body.provider === "velclaw"
        ? "Velclaw OAuth"
        : "Val Town (mặc định — chưa cấu hình Velclaw OAuth)";
    }

    if (body.ok) {
      setPill(healthPill, healthPillText, "ok", "Hoạt động bình thường");
    } else {
      setPill(healthPill, healthPillText, "warn", "Có sự cố");
    }
  } catch (err) {
    healthEl.textContent = `Lỗi: ${err.message}`;
    setPill(healthPill, healthPillText, "warn", "Không kết nối được");
  }
}

loadSession();
loadHealth();
