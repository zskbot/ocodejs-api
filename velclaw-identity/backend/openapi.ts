// OpenAPI 3.1 description of this val's HTTP surface.
//
// Kept as a plain object rather than a static JSON file so the server URL and
// descriptions stay in one place with the routes. Tools (Postman, Insomnia,
// Swagger UI, agent planners) can import /api/openapi.json directly.

export function openApiDocument(serverUrl: string) {
  const json = (schema: Record<string, unknown>) => ({
    "application/json": { schema },
  });

  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

  return {
    openapi: "3.1.0",
    info: {
      title: "Velclaw Identity API",
      version: "1.0.0",
      summary:
        "Xác thực tập trung cho Velclaw: JWT verification, session, token issuance.",
      description:
        "Lớp identity chạy trên Val Town. Verify JWT do Neon Auth phát hành qua " +
        "JWKS, giữ session phía máy chủ, và cấp access token ngắn hạn cho các " +
        "service khác trong hệ sinh thái.",
      license: { name: "Xem LICENSE trong repository nguồn" },
    },
    servers: [{ url: serverUrl, description: "Val Town deployment" }],
    tags: [
      { name: "auth", description: "Đăng nhập và session" },
      { name: "identity", description: "Danh tính người dùng hiện tại" },
      { name: "tokens", description: "Verify và cấp token" },
      { name: "meta", description: "Trạng thái, khám phá, tài liệu" },
    ],
    paths: {
      "/": {
        get: {
          tags: ["meta"],
          summary: "Trang chủ",
          description: "Giao diện HTML hiển thị trạng thái phiên và dịch vụ.",
          responses: {
            "200": {
              description: "HTML",
              content: { "text/html": { schema: { type: "string" } } },
            },
          },
          security: [],
        },
      },
      "/auth/login": {
        get: {
          tags: ["auth"],
          summary: "Bắt đầu đăng nhập",
          description:
            "Chuyển hướng tới provider đang cấu hình. Velclaw OAuth khi có " +
            "`VELCLAW_OAUTH_CLIENT_ID`, ngược lại dùng Val Town (không cần cấu hình). " +
            "Đặt cookie state/PKCE có TTL 10 phút.",
          responses: {
            "302": {
              description: "Redirect tới provider",
              headers: {
                location: {
                  schema: { type: "string", format: "uri" },
                  description: "URL uỷ quyền của provider",
                },
              },
            },
          },
          security: [],
        },
      },
      "/auth/callback": {
        get: {
          tags: ["auth"],
          summary: "Callback của provider",
          description:
            "Đối chiếu state, đổi code lấy token, verify `id_token` (nếu có) với " +
            "JWKS, tạo session và đặt cookie `velclaw_session`. Provider được chọn " +
            "bằng cookie `velclaw_oauth_provider`.",
          parameters: [
            {
              name: "code",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "state",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "error",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Provider trả lỗi thay vì code",
            },
          ],
          responses: {
            "302": {
              description: "Thành công (về `/`) hoặc lỗi (về `/?error=…`)",
            },
          },
          security: [],
        },
      },
      "/auth/logout": {
        post: {
          tags: ["auth"],
          summary: "Đăng xuất",
          description:
            "Thu hồi session hiện tại trong database (không chỉ xoá cookie) và xoá cookie.",
          responses: {
            "200": {
              description: "Đã đăng xuất",
              content: json({
                type: "object",
                properties: { ok: { type: "boolean" } },
                required: ["ok"],
              }),
            },
          },
        },
      },
      "/api/me": {
        get: {
          tags: ["identity"],
          summary: "Danh tính hiện tại",
          description: "Trả về identity của session đang hoạt động.",
          responses: {
            "200": {
              description: "Đã đăng nhập",
              content: json({
                type: "object",
                properties: {
                  user: {
                    type: "object",
                    properties: {
                      id: { type: "string", examples: ["vt:12345"] },
                      email: { type: ["string", "null"] },
                      name: { type: ["string", "null"] },
                      issuer: { type: ["string", "null"] },
                    },
                    required: ["id"],
                  },
                },
                required: ["user"],
              }),
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/verify": {
        post: {
          tags: ["tokens"],
          summary: "Verify một JWT",
          description:
            "Kiểm tra chữ ký với JWKS, thuật toán nằm trong allowlist, `exp`/`iss`/`aud` " +
            "hợp lệ. Chấp nhận token qua header `Authorization: Bearer` hoặc body `{ token }`.",
          requestBody: {
            required: false,
            content: json({
              type: "object",
              properties: { token: { type: "string" } },
              required: ["token"],
            }),
          },
          responses: {
            "200": {
              description: "Token hợp lệ",
              content: json({
                type: "object",
                properties: {
                  valid: { type: "boolean", const: true },
                  identity: ref("Identity"),
                },
                required: ["valid", "identity"],
              }),
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": {
              description: "Token không hợp lệ",
              content: json({
                type: "object",
                properties: {
                  valid: { type: "boolean", const: false },
                  error: { type: "string" },
                },
                required: ["valid", "error"],
              }),
            },
          },
          security: [{ bearerAuth: [] }, {}],
        },
      },
      "/api/token": {
        post: {
          tags: ["tokens"],
          summary: "Cấp access token",
          description:
            "Cấp JWT HS256 ngắn hạn cho user đang đăng nhập. Cần " +
            "`VELCLAW_IDENTITY_SECRET`; trả 500 nếu chưa cấu hình.",
          responses: {
            "200": {
              description: "Token đã cấp",
              content: json({
                type: "object",
                properties: {
                  token: { type: "string" },
                  expiresIn: { type: "integer", examples: [3600] },
                },
                required: ["token", "expiresIn"],
              }),
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "500": { $ref: "#/components/responses/ServerError" },
          },
        },
      },
      "/.well-known/jwks.json": {
        get: {
          tags: ["tokens"],
          summary: "JWKS mirror",
          description:
            "Bản sao JWKS của upstream (Neon Auth), cache 10 phút. Hữu ích khi " +
            "service khác muốn pin một URL duy nhất.",
          responses: {
            "200": {
              description: "JWKS",
              content: json({
                type: "object",
                properties: {
                  keys: {
                    type: "array",
                    items: { type: "object", additionalProperties: true },
                  },
                },
                required: ["keys"],
              }),
            },
          },
          security: [],
        },
      },
      "/api/skills.json": {
        get: {
          tags: ["meta"],
          summary: "Danh mục skills",
          description:
            "Catalog skills tĩnh (nhóm + mô tả). Tham chiếu, không host hay thực thi skill nào.",
          parameters: [
            {
              name: "category",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: ["codebase", "frontend", "creative", "automation"],
              },
              description: "Lọc theo nhóm",
            },
            {
              name: "q",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Tìm trong tên và mô tả (không phân biệt hoa thường)",
            },
          ],
          responses: {
            "200": {
              description: "Catalog",
              content: json({
                type: "object",
                properties: {
                  source: { type: "string" },
                  upstream: { type: "string" },
                  install: { type: "string" },
                  notice: { type: "string" },
                  categories: {
                    type: "array",
                    items: ref("SkillCategory"),
                  },
                  skills: { type: "array", items: ref("Skill") },
                  counts: {
                    type: "object",
                    properties: {
                      categories: { type: "integer" },
                      skills: { type: "integer" },
                    },
                  },
                },
              }),
            },
          },
          security: [],
        },
      },
      "/api/openapi.json": {
        get: {
          tags: ["meta"],
          summary: "OpenAPI spec",
          description: "Tài liệu này, dạng máy đọc được.",
          responses: {
            "200": {
              description: "OpenAPI 3.1 document",
              content: json({ type: "object", additionalProperties: true }),
            },
          },
          security: [],
        },
      },
      "/api/health": {
        get: {
          tags: ["meta"],
          summary: "Trạng thái dịch vụ",
          description:
            "Kiểm tra JWKS có truy cập được không và provider đang hoạt động.",
          responses: {
            "200": {
              description: "Khoẻ",
              content: json(ref("Health")),
            },
            "503": { description: "JWKS không truy cập được", content: json(ref("Health")) },
          },
          security: [],
        },
      },
      "/api/ecosystem.json": {
        get: {
          tags: ["meta"],
          summary: "Ecosystem registry",
          description:
            "Danh mục repository và dependency, cùng schema với " +
            "`ecosystem/repositories.json` của docs-ocodejs.",
          responses: {
            "200": {
              description: "Registry",
              content: json({ type: "object", additionalProperties: true }),
            },
          },
          security: [],
        },
      },
      "/api/admin/stats": {
        get: {
          tags: ["admin"],
          summary: "Thống kê",
          description: "Yêu cầu đăng nhập bằng handle nằm trong allowlist.",
          responses: {
            "200": {
              description: "Thống kê",
              content: json({ type: "object", additionalProperties: true }),
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
          },
        },
      },
      "/api/admin/audit": {
        get: {
          tags: ["admin"],
          summary: "Audit log",
          description: "Sự kiện gần nhất. `?event=` lọc, `?limit=` tối đa 200.",
          parameters: [
            {
              name: "event",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: [
                  "login.success",
                  "login.failure",
                  "logout",
                  "verify.success",
                  "verify.failure",
                  "apikey.created",
                  "apikey.revoked",
                  "ratelimit.blocked",
                ],
              },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", default: 50, maximum: 200 },
            },
          ],
          responses: {
            "200": {
              description: "Danh sách sự kiện",
              content: json({ type: "object", additionalProperties: true }),
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
          },
        },
      },
      "/api/admin/keys": {
        get: {
          tags: ["admin"],
          summary: "Liệt kê API key",
          description: "Metadata only — không bao giờ trả hash.",
          responses: {
            "200": {
              description: "Danh sách key",
              content: json({ type: "object", additionalProperties: true }),
            },
            "403": { $ref: "#/components/responses/Forbidden" },
          },
        },
        post: {
          tags: ["admin"],
          summary: "Tạo API key",
          description:
            "Plaintext chỉ xuất hiện trong response này, không lưu ở đâu khác.",
          requestBody: {
            required: false,
            content: json({
              type: "object",
              properties: { name: { type: "string", maxLength: 80 } },
            }),
          },
          responses: {
            "201": {
              description: "Key đã tạo",
              content: json({
                type: "object",
                properties: {
                  key: { type: "string" },
                  id: { type: "string" },
                  prefix: { type: "string" },
                },
                required: ["key", "id", "prefix"],
              }),
            },
            "403": { $ref: "#/components/responses/Forbidden" },
          },
        },
      },
      "/api/admin/keys/{id}": {
        delete: {
          tags: ["admin"],
          summary: "Thu hồi API key",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Đã thu hồi" },
            "404": { description: "Không tìm thấy hoặc đã thu hồi" },
            "403": { $ref: "#/components/responses/Forbidden" },
          },
        },
      },
      "/docs": {
        get: {
          tags: ["meta"],
          summary: "Tài liệu API",
          description: "Trang HTML đọc được cho con người.",
          responses: {
            "200": {
              description: "HTML",
              content: { "text/html": { schema: { type: "string" } } },
            },
          },
          security: [],
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "velclaw_session",
        },
      },
      responses: {
        Unauthorized: {
          description: "Chưa đăng nhập",
          content: json({
            type: "object",
            properties: { error: { type: "string" } },
            required: ["error"],
          }),
        },
        Forbidden: {
          description: "Không có quyền admin",
          content: json({
            type: "object",
            properties: {
              error: { type: "string" },
              hint: { type: "string" },
            },
            required: ["error"],
          }),
        },
        BadRequest: {
          description: "Thiếu tham số",
          content: json({
            type: "object",
            properties: { error: { type: "string" } },
            required: ["error"],
          }),
        },
        ServerError: {
          description: "Lỗi cấu hình phía server",
          content: json({
            type: "object",
            properties: { error: { type: "string" } },
            required: ["error"],
          }),
        },
      },
      schemas: {
        Identity: {
          type: "object",
          properties: {
            sub: { type: "string", description: "Subject claim của token" },
            email: { type: ["string", "null"] },
            name: { type: ["string", "null"] },
            issuer: { type: ["string", "null"] },
            audience: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } },
                { type: "null" },
              ],
            },
            expiresAt: {
              type: "integer",
              description: "Unix milliseconds",
            },
            claims: { type: "object", additionalProperties: true },
          },
          required: ["sub"],
        },
        Skill: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            category: { type: "string" },
            source: { type: "string", format: "uri" },
          },
          required: ["id", "name", "description", "category", "source"],
        },
        SkillCategory: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
          },
          required: ["id", "name", "description"],
        },
        Health: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            provider: { type: "string", enum: ["velclaw", "valtown"] },
            oauth: {
              type: "object",
              properties: { configured: { type: "boolean" } },
            },
            jwks: {
              type: "object",
              properties: {
                url: { type: "string" },
                ok: { type: "boolean" },
                error: { type: ["string", "null"] },
              },
            },
          },
          required: ["ok", "provider"],
        },
      },
    },
  };
}
