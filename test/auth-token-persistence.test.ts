import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  buildAuthUrl,
  CLIENT_ID,
  generateCodeChallenge,
  generateCodeVerifier,
  generatePkcePair,
  isAuthorizationRedirectUrl,
  loadPendingPkce,
  parseRedirectCode,
  REDIRECT_URI,
  refreshTokens,
  savePendingPkce,
  TOKEN_URL,
} from "../src/auth.js";
import {
  FileTokenStore,
  loadMarketConfig,
  MemoryTokenStore,
  saveMarketConfig,
} from "../src/token-store.js";

test("PKCE helpers & OAuth URL builders produce valid Keycloak parameters", () => {
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  assert.ok(verifier.length >= 43);
  assert.ok(/^[A-Za-z0-9\-_]+$/.test(verifier));
  assert.ok(/^[A-Za-z0-9\-_]+$/.test(challenge));

  const pair = generatePkcePair();
  assert.equal(generateCodeChallenge(pair.codeVerifier), pair.codeChallenge);

  const url = new URL(buildAuthUrl({ codeChallenge: pair.codeChallenge, state: "st-42" }));
  assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT_URI);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge"), pair.codeChallenge);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "st-42");

  const deepLink = "de.rewe.app://redirect?code=auth-code-999&state=st-42";
  assert.equal(parseRedirectCode(deepLink), "auth-code-999");
  assert.equal(
    parseRedirectCode(
      "Failed to launch 'de.rewe.app://redirect?session_state=abc&code=my-auth-code-777' because the scheme does not have a registered handler."
    ),
    "my-auth-code-777"
  );
  assert.equal(parseRedirectCode("raw-code-123"), "raw-code-123");
  assert.equal(isAuthorizationRedirectUrl(deepLink), true);
  assert.equal(isAuthorizationRedirectUrl("https://account.rewe.de/login"), false);

  const tmpPkceDir = fs.mkdtempSync(path.join(os.tmpdir(), "rewe-mcp-pkce-test-"));
  const pkcePath = path.join(tmpPkceDir, "pkce.json");
  assert.equal(loadPendingPkce(pkcePath), null);
  savePendingPkce(
    { codeVerifier: pair.codeVerifier, state: "st-42", createdAt: "2026-11-15T12:00:00Z" },
    pkcePath
  );
  assert.equal(loadPendingPkce(pkcePath)?.codeVerifier, pair.codeVerifier);
  assert.equal(loadPendingPkce(pkcePath)?.state, "st-42");
});

test("FileTokenStore: saves with 0600 permissions, reloads, and serializes concurrent locks", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rewe-mcp-token-test-"));
  const tokensPath = path.join(tmpDir, "nested", "tokens.json");
  const store = new FileTokenStore(() => tokensPath);

  assert.equal(store.load(), null);
  store.assertWritable();

  const initial = {
    access_token: "at-initial",
    refresh_token: "rt-initial",
    expires_in: 300,
    customer_id: "cust-123",
  };
  store.save(initial);

  assert.equal(fs.existsSync(tokensPath), true);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(tokensPath).mode & 0o777, 0o600);
  }
  assert.deepEqual(store.load(), initial);

  const events: string[] = [];
  await Promise.all([
    store.withLock(async () => {
      events.push("start-1");
      await new Promise((r) => setTimeout(r, 40));
      events.push("end-1");
    }),
    store.withLock(async () => {
      events.push("start-2");
      await new Promise((r) => setTimeout(r, 10));
      events.push("end-2");
    }),
  ]);

  assert.deepEqual(events, ["start-1", "end-1", "start-2", "end-2"]);
});

test("loadMarketConfig & saveMarketConfig: persists default market in temp store.json", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rewe-mcp-store-test-"));
  const storePath = path.join(tmpDir, "store.json");

  const defaults = loadMarketConfig(storePath);
  assert.equal(typeof defaults.marketId, "string");
  assert.ok(defaults.marketId.length > 0);
  assert.ok(defaults.serviceType === "PICKUP" || defaults.serviceType === "DELIVERY");

  const saved = saveMarketConfig(
    {
      marketId: "831002",
      zipCode: "50667",
      serviceType: "DELIVERY",
      marketName: "REWE Center Köln",
      city: "Köln",
    },
    storePath
  );

  assert.equal(saved.marketId, "831002");
  assert.equal(saved.zipCode, "50667");
  assert.equal(saved.serviceType, "DELIVERY");
  assert.equal(saved.marketName, "REWE Center Köln");

  const reloaded = loadMarketConfig(storePath);
  assert.equal(reloaded.marketId, "831002");
  assert.equal(reloaded.serviceType, "DELIVERY");
  assert.equal(reloaded.city, "Köln");

  if (process.platform !== "win32") {
    assert.equal(fs.statSync(storePath).mode & 0o777, 0o600);
  }
});

test("refreshTokens: exchanges refresh_token at Keycloak TOKEN_URL and updates store", async () => {
  const store = new MemoryTokenStore({
    access_token: "old-at",
    refresh_token: "rt-before",
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  });

  const prevFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody = "";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = typeof input === "string" ? input : input.toString();
    capturedBody = typeof init?.body === "string" ? init.body : "";
    return new Response(
      JSON.stringify({
        access_token: "new-at-fresh",
        refresh_token: "rt-rotated",
        expires_in: 600,
        token_type: "Bearer",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }) as typeof fetch;

  try {
    const refreshed = await refreshTokens(undefined, store);
    assert.equal(capturedUrl, TOKEN_URL);
    const params = new URLSearchParams(capturedBody);
    assert.equal(params.get("grant_type"), "refresh_token");
    assert.equal(params.get("refresh_token"), "rt-before");

    assert.equal(refreshed.access_token, "new-at-fresh");
    assert.equal(refreshed.refresh_token, "rt-rotated");
    assert.equal(store.load()?.access_token, "new-at-fresh");
    assert.equal(store.load()?.refresh_token, "rt-rotated");
  } finally {
    globalThis.fetch = prevFetch;
  }
});
