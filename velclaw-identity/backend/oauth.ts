// Velclaw OAuth client.
//
// Velclaw's product domain is https://velclaw.dev (per the VELCLAW README: "the
// only canonical Velclaw domain"). The OAuth service itself lives in
// Velclaw/Oauth and its routing is not yet verified, so every URL here is
// overridable via env vars — point them at whatever the deployed service
// actually exposes.
//
// Flow is authorization-code + PKCE (S256), which is the right choice for a
// public client that can't hold a secret. We still send a secret when one is
// configured, because a server-side val *is* confidential.

const AUTHORIZE_URL = Deno.env.get("VELCLAW_OAUTH_AUTHORIZE_URL") ??
  "https://velclaw.dev/auth/authorize";
const TOKEN_URL = Deno.env.get("VELCLAW_OAUTH_TOKEN_URL") ??
  "https://velclaw.dev/auth/token";
const USERINFO_URL = Deno.env.get("VELCLAW_OAUTH_USERINFO_URL") ??
  "https://velclaw.dev/auth/userinfo";
const SCOPES = Deno.env.get("VELCLAW_OAUTH_SCOPES") ??
  "openid email profile offline_access";

function config() {
  return {
    clientId: Deno.env.get("VELCLAW_OAUTH_CLIENT_ID") ?? "",
    clientSecret: Deno.env.get("VELCLAW_OAUTH_CLIENT_SECRET") ?? "",
    redirectUri: Deno.env.get("VELCLAW_OAUTH_REDIRECT_URI") ?? "",
  };
}

export function isConfigured(): boolean {
  const { clientId, redirectUri } = config();
  return Boolean(clientId && redirectUri);
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createPkcePair() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier),
      ),
    ),
  );
  return { verifier, challenge };
}

export function randomState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(24)));
}

/** Builds the URL we send the browser to in order to start the login. */
export function buildAuthorizeUrl(input: {
  state: string;
  codeChallenge: string;
}): string {
  const { clientId, redirectUri } = config();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export type TokenSet = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

export async function exchangeCode(input: {
  code: string;
  codeVerifier: string;
}): Promise<TokenSet> {
  const { clientId, clientSecret, redirectUri } = config();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: input.codeVerifier,
  });

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };

  // Confidential client: authenticate with HTTP Basic when a secret exists.
  if (clientSecret) {
    headers.authorization = `Basic ${
      btoa(`${clientId}:${clientSecret}`)
    }`;
  }

  const res = await fetch(TOKEN_URL, { method: "POST", headers, body });
  if (!res.ok) {
    throw new Error(
      `Token exchange failed: ${res.status} ${await res.text()}`,
    );
  }
  return await res.json() as TokenSet;
}

export async function fetchUserInfo(accessToken: string) {
  const res = await fetch(USERINFO_URL, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Userinfo failed: ${res.status} ${await res.text()}`);
  }
  return await res.json() as {
    sub?: string;
    email?: string;
    name?: string;
    [key: string]: unknown;
  };
}
