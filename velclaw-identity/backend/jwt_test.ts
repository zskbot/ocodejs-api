// Self-test for the JWT verification path.
//
// The health check only proves the JWKS is reachable. This script proves the
// *cryptography and policy* behave: a token signed by a real key we generate is
// accepted, and the classic forgery attempts are rejected.
//
// Run it from the val editor.

import { SignJWT, exportJWK, generateKeyPair } from "npm:jose@5";
import {
  configureJwks,
  signAccessToken,
  verifyAccessToken,
  verifyJwt,
} from "./jwks.ts";

let failures = 0;
let passes = 0;

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passes++;
    console.log(`✅ ${name}`);
  } catch (err) {
    failures++;
    console.log(`❌ ${name}`);
    console.log(`   ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Asserts that `fn` throws — used for the rejection cases. */
async function expectReject(name: string, fn: () => Promise<unknown>) {
  await check(name, async () => {
    try {
      await fn();
    } catch {
      return; // threw as expected
    }
    throw new Error("Expected rejection but verification succeeded");
  });
}

function b64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// --- Ed25519 (the algorithm Neon Auth actually publishes) ----------------

const ed = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
const edJwk = await exportJWK(ed.publicKey);
const edKid = "test-ed25519";
edJwk.kid = edKid;
edJwk.alg = "EdDSA";

/** Points verification at a JWKS we control, for the duration of `fn`. */
async function withTestJwks<T>(fn: () => Promise<T>): Promise<T> {
  // `Deno.env.set` is a no-op on Val Town, so config goes in explicitly.
  configureJwks({ keys: [edJwk] });
  try {
    return await fn();
  } finally {
    configureJwks(null);
  }
}

// A secret for the access-token tests, passed explicitly rather than via env.
const TEST_SECRET = "test-secret-not-used-in-production";

// Signs a token with the key the fake JWKS publishes.
async function makeToken(
  claims: Record<string, unknown>,
  opts: { kid?: string; alg?: string; expiresIn?: number } = {},
) {
  const signer = new SignJWT(claims)
    .setProtectedHeader({
      alg: opts.alg ?? "EdDSA",
      typ: "JWT",
      kid: opts.kid ?? edKid,
    })
    .setSubject(String(claims.sub ?? "user_123"))
    .setIssuedAt();

  if (opts.expiresIn !== 0) {
    signer.setExpirationTime(Math.floor(Date.now() / 1000) + (opts.expiresIn ?? 300));
  }
  return await signer.sign(ed.privateKey);
}

await withTestJwks(async () => {
  await check("accepts a valid Ed25519 token", async () => {
    const token = await makeToken({ email: "user@velclaw.dev", sub: "user_123" });
    const identity = await verifyJwt(token);
    if (identity.sub !== "user_123") {
      throw new Error(`Wrong sub: ${identity.sub}`);
    }
    if (identity.email !== "user@velclaw.dev") {
      throw new Error(`Wrong email: ${identity.email}`);
    }
  });

  await expectReject("rejects a tampered payload", async () => {
    const token = await makeToken({ email: "user@velclaw.dev", sub: "user_123" });
    const [h, , s] = token.split(".");
    const forgedPayload = b64url(
      JSON.stringify({
        sub: "attacker",
        email: "attacker@evil.dev",
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    );
    await verifyJwt(`${h}.${forgedPayload}.${s}`);
  });

  await expectReject("rejects alg=none", async () => {
    const token = `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${
      b64url(JSON.stringify({ sub: "attacker" }))
    }.`;
    await verifyJwt(token);
  });

  await expectReject("rejects HS256 signed with a confusing key", async () => {
    // Classic algorithm-confusion attempt: sign with the *public* JWKS material
    // as an HMAC secret, hoping the verifier treats it as a symmetric key.
    const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: edKid }));
    const payload = b64url(
      JSON.stringify({ sub: "attacker", exp: Math.floor(Date.now() / 1000) + 300 }),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JSON.stringify(edJwk)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`)),
    );
    const b64sig = btoa(String.fromCharCode(...sig))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await verifyJwt(`${header}.${payload}.${b64sig}`);
  });

  await expectReject("rejects an expired token", async () => {
    const token = await new SignJWT({ sub: "user_123" })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: edKid })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(ed.privateKey);
    await verifyJwt(token);
  });

  await expectReject("rejects a token with no sub", async () => {
    const token = await new SignJWT({ email: "user@velclaw.dev" })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: edKid })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
      .sign(ed.privateKey);
    await verifyJwt(token);
  });

  await expectReject("rejects an unknown kid", async () => {
    const token = await new SignJWT({ email: "user@velclaw.dev" })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: "does-not-exist" })
      .setSubject("user_123")
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
      .sign(ed.privateKey);
    await verifyJwt(token);
  });

  await expectReject("rejects a malformed token", async () => {
    await verifyJwt("not-a-jwt");
  });
});

// --- our own access tokens ----------------------------------------------

await check("round-trips a Velclaw access token", async () => {
  const token = await signAccessToken(
    { sub: "user_123", email: "user@velclaw.dev" },
    3600,
    TEST_SECRET,
  );
  const identity = await verifyAccessToken(token, TEST_SECRET);
  if (identity.sub !== "user_123") throw new Error(`Wrong sub: ${identity.sub}`);
  if (identity.email !== "user@velclaw.dev") {
    throw new Error(`Wrong email: ${identity.email}`);
  }
});

await expectReject("rejects an access token with a bad signature", async () => {
  const token = await signAccessToken({ sub: "user_123", email: null }, 3600, TEST_SECRET);
  const [h, p] = token.split(".");
  await verifyAccessToken(`${h}.${p}.AAAA`, TEST_SECRET);
});

await expectReject("rejects an access token signed with a different secret", async () => {
  const token = await signAccessToken({ sub: "user_123", email: null }, 3600, TEST_SECRET);
  await verifyAccessToken(token, "some-other-secret");
});

await expectReject("rejects an expired access token", async () => {
  const token = await signAccessToken(
    { sub: "user_123", email: null },
    -60, // already expired
    TEST_SECRET,
  );
  await verifyAccessToken(token, TEST_SECRET);
});

await check("access token verification requires a configured secret", async () => {
  const token = await signAccessToken({ sub: "user_123", email: null }, 3600, TEST_SECRET);
  let threw = false;
  try {
    await verifyAccessToken(token); // no override, no env secret
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("Expected an error when no secret is configured");
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
