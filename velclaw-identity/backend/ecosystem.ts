// Ecosystem registry.
//
// Mirrors the schema of zskbot/docs-ocodejs `ecosystem/repositories.json`
// (schemaVersion 1) so a consumer can treat both as the same shape, but adds
// the repositories this deployment actually knows about.
//
// Static on purpose: no upstream fetch, so /api/ecosystem.json never depends on
// GitHub availability or its unauthenticated rate limit (60 req/hour).
// Update this file when the real inventory changes.

export type Repository = {
  name: string;
  url: string;
  /** What the repo is for, in the upstream vocabulary. */
  role: string;
  criticality: "high" | "medium" | "low";
  runtime: string;
  deployment: string;
  healthCheck: string;
  secretPolicy: string;
  /** Optional: live site, when one exists. */
  homepage?: string;
  /** Optional: what this deployment uses it for. */
  usedFor?: string;
};

export const REPOSITORIES: Repository[] = [
  {
    name: "docs-ocodejs",
    url: "https://github.com/zskbot/docs-ocodejs",
    role: "documentation-hub",
    criticality: "high",
    runtime: "static-documentation",
    deployment: "GitHub Pages or configured static host",
    healthCheck: "documentation link validation and static build",
    secretPolicy:
      "GitHub Actions secrets only; never store token values in this inventory",
    homepage: "https://zskbot.github.io/docs-ocodejs/",
    usedFor: "Nguồn DESIGN_SYSTEM.md và danh mục skills của val này",
  },
  {
    name: "ask-ocodejs",
    url: "https://github.com/zskbot/ask-ocodejs",
    role: "application-agent",
    criticality: "high",
    runtime: "TypeScript, Bun, Prisma",
    deployment: "GitHub Pages (tĩnh) + backend cần deploy riêng",
    healthCheck: "type-check, build, và kiểm thử API",
    secretPolicy:
      "AUTH_SECRET, database URL và provider keys chỉ đặt ở server environment",
    homepage: "https://zskbot.github.io/ask-ocodejs/",
    usedFor: "Tham chiếu kiến trúc; chưa có endpoint backend công khai",
  },
  {
    name: "Velclaw-OCodejs",
    url: "https://github.com/Velclaw/Velclaw-OCodejs",
    role: "application-workspace",
    criticality: "high",
    runtime: "TypeScript",
    deployment: "Vercel",
    healthCheck: "type-check, build, /health",
    secretPolicy: "Credentials server-side only; không commit .env",
    homepage: "https://velclaw.cfd",
    usedFor: "Workspace chính của Velclaw; tách auth sang val này",
  },
  {
    name: "VELCLAW",
    url: "https://github.com/Velclaw/VELCLAW",
    role: "application-template",
    criticality: "medium",
    runtime: "Next.js, React, TypeScript, Postgres",
    deployment: "Vercel / Render",
    healthCheck: "npm run type-check, npm run build",
    secretPolicy:
      "Không commit API key, OAuth secret, database URL hoặc deployment token",
    homepage: "http://velclaw.site",
    usedFor: "Contract `Authentication/JWKS` (Neon Auth) mà val này verify",
  },
  {
    name: "Oauth",
    url: "https://github.com/Velclaw/Oauth",
    role: "identity-provider",
    criticality: "high",
    runtime: "Chưa xác định",
    deployment: "Chưa verify hostname/routing",
    healthCheck: "Chưa có",
    secretPolicy: "OAuth client secret chỉ ở server",
    usedFor:
      "Provider đích cho luồng Velclaw OAuth (đang chờ client_id để bật)",
  },
  {
    name: "X-BO",
    url: "https://github.com/zskbot/X-BO",
    role: "AI-agent-application",
    criticality: "high",
    runtime: "Node.js and Vite",
    deployment: "Vercel and optional standalone Node server",
    healthCheck: "unit tests, frontend build, and /health endpoint",
    secretPolicy:
      "provider credentials must remain server-side environment variables",
  },
  {
    name: "pages_logo",
    url: "https://github.com/zskbot/pages_logo",
    role: "brand-assets",
    criticality: "medium",
    runtime: "static-assets",
    deployment: "GitHub Pages",
    healthCheck: "asset-reference validation and static-site build",
    secretPolicy: "public assets only; no credentials or private user data",
    usedFor: "Logo động OCode.js",
  },
];

/**
 * Live dependency status, observed from this deployment.
 *
 * These are claims this val can actually check — not aspirational state.
 */
export const DEPENDENCIES = [
  {
    name: "Neon Auth JWKS",
    purpose: "Verify JWT phát hành bởi Neon",
    check: "/api/health",
  },
  {
    name: "Val Town OAuth",
    purpose: "Đăng nhập không cần cấu hình",
    check: "/auth/login",
  },
  {
    name: "Velclaw OAuth",
    purpose: "Đăng nhập bằng tài khoản Velclaw",
    check: "VELCLAW_OAUTH_CLIENT_ID",
    status: "pending-config",
  },
];

export function ecosystem() {
  return {
    schemaVersion: 1,
    updatedAt: "2026-10-26",
    source:
      "https://github.com/zskbot/docs-ocodejs/blob/main/ecosystem/repositories.json",
    notice:
      "Danh mục tham chiếu. Liệt kê không phải xác nhận rằng mọi file đã được " +
      "kiểm tra hoặc repo đã production-ready.",
    repositories: REPOSITORIES,
    dependencies: DEPENDENCIES,
    counts: {
      repositories: REPOSITORIES.length,
      byRole: REPOSITORIES.reduce<Record<string, number>>((acc, repo) => {
        acc[repo.role] = (acc[repo.role] ?? 0) + 1;
        return acc;
      }, {}),
    },
  };
}
