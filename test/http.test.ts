import assert from "node:assert/strict";
import test from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { TtlCache } from "../src/cache.js";
import { ReweClient } from "../src/client.js";
import { resolveHttpConfigFromEnv, startHttpServer } from "../src/http.js";
import { createServer } from "../src/index.js";

function jsonResponse(payload: unknown, status = 200) {
  const body = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    buffer: async () => Buffer.from(body, "utf-8"),
    text: async () => body,
    json: async () => payload,
  };
}

test("startHttpServer: serves /healthz, supports multi-session Streamable HTTP, and shares ReweClient cache", async () => {
  let marketApiCalls = 0;
  const sharedClient = new ReweClient({
    cache: new TtlCache({ maxEntries: 50 }),
    marketConfig: { marketId: "840174", zipCode: "50667", serviceType: "PICKUP" },
    fetchFn: async (url) => {
      if (url.includes("/api/stationary-markets?search=")) {
        marketApiCalls += 1;
        return jsonResponse({
          data: {
            marketSearch: {
              markets: [{ wwIdent: "840174", name: "REWE Köln", zipCode: "50667", city: "Köln" }],
            },
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const running = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    client: sharedClient,
    createServer: (c) => createServer(c),
    log: () => {},
  });

  const client1 = new Client({ name: "http-client-1", version: "0.1.0" });
  const client2 = new Client({ name: "http-client-2", version: "0.1.0" });

  try {
    const healthRes = await fetch(running.healthUrl);
    assert.equal(healthRes.status, 200);
    const health = (await healthRes.json()) as any;
    assert.equal(health.status, "ok");
    assert.equal(health.server, "rewe-mcp");
    assert.equal(health.transport, "streamable-http");
    assert.equal(health.sessions, 0);

    await client1.connect(new StreamableHTTPClientTransport(new URL(running.url)));
    await client2.connect(new StreamableHTTPClientTransport(new URL(running.url)));
    assert.equal(running.getSessionCount(), 2);

    const { tools } = await client1.listTools();
    assert.equal(tools.length, 30);

    const r1 = await client1.callTool({
      name: "rewe_search_markets",
      arguments: { query: "Köln" },
    });
    const r2 = await client2.callTool({
      name: "rewe_search_markets",
      arguments: { query: "Köln" },
    });

    assert.equal((r1.structuredContent as any).markets[0].wwIdent, "840174");
    assert.equal((r2.structuredContent as any).markets[0].wwIdent, "840174");
    assert.equal(marketApiCalls, 1, "Second session must hit the shared TtlCache");
  } finally {
    await client1.close().catch(() => {});
    await client2.close().catch(() => {});
    await running.close();
  }
});

test("startHttpServer: enforces bearer auth, rejects missing/unknown sessions, and handles stateless POST", async () => {
  const sharedClient = new ReweClient({
    cache: new TtlCache({ maxEntries: 50 }),
    marketConfig: { marketId: "840174", zipCode: "50667", serviceType: "PICKUP" },
    fetchFn: async () => jsonResponse({}),
  });

  const running = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    authToken: "super-secret-token",
    client: sharedClient,
    createServer: (c) => createServer(c),
    log: () => {},
  });

  const authedClient = new Client({ name: "authed-client", version: "0.1.0" });

  try {
    // Missing Authorization header -> 401
    const noAuth = await fetch(running.url, { method: "GET" });
    assert.equal(noAuth.status, 401);
    assert.match(noAuth.headers.get("www-authenticate") || "", /Bearer/i);

    // Wrong Authorization header -> 401
    const badAuth = await fetch(running.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    assert.equal(badAuth.status, 401);

    // Valid token + GET without Mcp-Session-Id -> 400
    const missingSession = await fetch(running.url, {
      method: "GET",
      headers: { Authorization: "Bearer super-secret-token" },
    });
    assert.equal(missingSession.status, 400);

    // Valid token + unknown Mcp-Session-Id -> 404
    const unknownSession = await fetch(running.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer super-secret-token",
        "Mcp-Session-Id": "does-not-exist",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    assert.equal(unknownSession.status, 404);

    // Valid token + stateless POST fallback (no Mcp-Session-Id, non-initialize request)
    const statelessRes = await fetch(running.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer super-secret-token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} }),
    });
    assert.equal(statelessRes.status, 200);
    const statelessJson = (await statelessRes.json()) as any;
    assert.equal(statelessJson.result.tools.length, 30);

    // Full MCP client connection with bearer auth
    await authedClient.connect(
      new StreamableHTTPClientTransport(new URL(running.url), {
        requestInit: {
          headers: { Authorization: "Bearer super-secret-token" },
        },
      })
    );
    const listed = await authedClient.listTools();
    assert.equal(listed.tools.length, 30);
  } finally {
    await authedClient.close().catch(() => {});
    await running.close();
  }
});

test("resolveHttpConfigFromEnv: parses MCP_HTTP_* variables accurately", () => {
  const envKeys = [
    "MCP_HTTP_PORT",
    "MCP_HTTP_HOST",
    "MCP_HTTP_PATH",
    "MCP_HTTP_AUTH_TOKEN",
    "MCP_HTTP_JSON_RESPONSE",
  ] as const;

  const backup = new Map<string, string | undefined>();
  for (const key of envKeys) backup.set(key, process.env[key]);

  try {
    process.env.MCP_HTTP_PORT = "4123";
    process.env.MCP_HTTP_HOST = "0.0.0.0";
    process.env.MCP_HTTP_PATH = "custom-mcp/";
    process.env.MCP_HTTP_AUTH_TOKEN = "tok-xyz";
    process.env.MCP_HTTP_JSON_RESPONSE = "true";

    const cfg = resolveHttpConfigFromEnv();
    assert.equal(cfg.port, 4123);
    assert.equal(cfg.host, "0.0.0.0");
    assert.equal(cfg.path, "/custom-mcp");
    assert.equal(cfg.authToken, "tok-xyz");
    assert.equal(cfg.enableJsonResponse, true);
  } finally {
    for (const [key, value] of backup.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
