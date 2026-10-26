// "Log in with Val Town" — a zero-config identity source.
//
// Why not `oauthMiddleware` from std/oauth? It hard-codes five paths
// (/auth/login, /auth/callback, /auth/logout, /auth/logo, /auth/client/*) and
// has no prefix option — so wrapping our app with it would steal
// /auth/login and /auth/callback from the Velclaw OAuth flow.
//
// Instead we speak the same OAuth protocol ourselves, on a distinct path
// (/auth/valtown/*). Same client registration mechanics, same result, but the
// two login flows can coexist and be switched by configuration.

import {
  decodeState,
  encodeState,
  generatePKCE,
  getDefaultClientName,
  getOrCreateClient,
  getRedirectUri,
} from "https://esm.town/v/std/oauth@233-main/oauth.ts";
import { parseVal } from "https://esm.town/v/std/utils/index.ts";
import ValTown from "npm:@valtown/sdk@3.10.0";

const OAUTH_ISSUER = "https://val.town";
const DEFAULT_SCOPES = ["openid", "offline_access", "profile", "user_r"];

export type ValTownProfile = {
  id: string;
  username: string;
  email: string | null;
};

/**
 * Val Town's OAuth redirect must land on <origin>/auth/callback — the SDK
 * derives its client and session key from that exact URL. Because that path
 * belongs to Velclaw in this val, we register the Val Town client against the
 * val's own origin and use the *same* callback path, disambiguating by an
 * `provider` marker inside the state value instead of by path.
 */
export function valtownRedirectUri(req: Request): string {
  return getRedirectUri(req);
}

/** Builds the URL to send the browser to in order to start a Val Town login. */
export async function valtownAuthorizeUrl(req: Request): Promise<string> {
  const redirectUri = valtownRedirectUri(req);
  const clientId = await getOrCreateClient(
    redirectUri,
    getDefaultClientName(),
  );

  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = await encodeState(codeVerifier, clientId, redirectUri);

  const authUrl = new URL(`${OAUTH_ISSUER}/oauth/auth`);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", DEFAULT_SCOPES.join(" "));
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "login consent");

  return authUrl.toString();
}

/** Exchanges the authorization code for an access token, then loads the profile. */
export async function valtownExchange(
  req: Request,
  code: string,
  state: string,
): Promise<{ profile: ValTownProfile; isOrgMember: boolean }> {
  const redirectUri = valtownRedirectUri(req);
  const { codeVerifier, clientId } = await decodeState(state, redirectUri);

  const tokenRes = await fetch(`${OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(
      `Val Town token exchange failed: ${tokenRes.status} ${await tokenRes
        .text()}`,
    );
  }

  const tokens = await tokenRes.json() as { access_token: string };
  const client = new ValTown({ bearerToken: tokens.access_token });

  const orgHandle = parseVal().username;
  const [me, userOrgs] = await Promise.all([
    client.me.profile.retrieve(),
    Array.fromAsync(client.orgs.list({})),
  ]);

  const username = me.username;
  if (typeof username !== "string" || username.trim() === "") {
    throw new Error("Val Town profile is missing a username");
  }

  const isOrgMember = username === orgHandle ||
    userOrgs.some((o) => o.username === orgHandle);

  return {
    profile: {
      id: String(me.id),
      username,
      email: (me as { email?: string | null }).email ?? null,
    },
    isOrgMember,
  };
}

/**
 * A stable identity id for a Val Town user.
 *
 * The `vt:` prefix keeps these from ever colliding with a Velclaw/Neon `sub`,
 * which matters because both kinds of id share the `identities` table.
 */
export function valtownIdentityId(user: { id: string }): string {
  return `vt:${user.id}`;
}
