import test from "node:test";
import assert from "node:assert/strict";
import { TtlCache } from "../src/cache.js";
import { ReweApiError, ReweClient } from "../src/client.js";
import { MemoryTokenStore } from "../src/token-store.js";

test("ReweClient: sends required mTLS/market headers and unwraps GraphQL envelopes", async () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string; useMtls?: boolean }> = [];
  const client = new ReweClient({
    cache: new TtlCache({ maxEntries: 100 }),
    marketConfig: { marketId: "840174", zipCode: "68199", serviceType: "PICKUP" },
    fetchFn: async (url, init) => {
      calls.push({
        url,
        method: init.method || "GET",
        headers: init.headers || {},
        body: init.body,
        useMtls: init.useMtls,
      });
      if (url.includes("/api/stationary-markets?search=")) {
        return {
          ok: true,
          status: 200,
          buffer: async () => Buffer.from("{}"),
          text: async () =>
            JSON.stringify({
              data: {
                marketSearch: {
                  markets: [{ wwIdent: "840174", name: "REWE Mannheim", zipCode: "68199" }],
                },
              },
            }),
          json: async () => ({}),
        };
      }
      if (url.includes("/api/products?")) {
        return {
          ok: true,
          status: 200,
          buffer: async () => Buffer.from("{}"),
          text: async () =>
            JSON.stringify({
              data: {
                products: {
                  products: [
                    {
                      productId: "p-hafer",
                      title: "REWE Bio Haferdrink",
                      listing: { listingId: "l-hafer", currentRetailPrice: 129 },
                    },
                  ],
                  pagination: { currentPage: 1, objectsPerPage: 30, pageCount: 1, objectCount: 1 },
                },
              },
            }),
          json: async () => ({}),
        };
      }
      if (url.includes("/api/recipes/bad")) {
        return {
          ok: true,
          status: 200,
          buffer: async () => Buffer.from("{}"),
          text: async () =>
            JSON.stringify({
              data: null,
              errors: [{ message: "Recipe lookup failed upstream" }],
            }),
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        buffer: async () => Buffer.from("{}"),
        text: async () => JSON.stringify({ data: {} }),
        json: async () => ({}),
      };
    },
  });

  const markets = await client.searchMarkets("Mannheim");
  assert.strictEqual(markets[0].wwIdent, "840174");
  assert.strictEqual(calls[0].useMtls, true);
  assert.ok(calls[0].headers["rdfa"]);
  assert.ok(calls[0].headers["x-instana-android"]);
  assert.ok(calls[0].headers["correlation-id"]);

  const prods = await client.searchProducts({ query: "Hafer" });
  assert.strictEqual(prods.products[0].price, 1.29);
  const prodHeaders = calls[1].headers;
  assert.strictEqual(prodHeaders["rd-market-id"], "840174");
  assert.strictEqual(prodHeaders["x-rd-market-id"], "840174");
  assert.strictEqual(prodHeaders["rd-service-types"], "PICKUP");
  assert.strictEqual(prodHeaders["x-rd-service-types"], "PICKUP");
  assert.strictEqual(prodHeaders["rd-postcode"], "68199");

  await assert.rejects(
    () => client.getRecipeDetails("bad"),
    (err: unknown) =>
      err instanceof ReweApiError &&
      err.code === "UPSTREAM_ERROR" &&
      err.message.includes("Recipe lookup failed upstream")
  );
});

test("ReweClient: retries once on 401 by refreshing token", async () => {
  const store = new MemoryTokenStore({
    access_token: "stale-token",
    refresh_token: "valid-refresh-token",
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  });

  const origFetch = globalThis.fetch;
  let tokenRefreshCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/protocol/openid-connect/token")) {
      tokenRefreshCalls += 1;
      return new Response(
        JSON.stringify({
          access_token: "fresh-token",
          refresh_token: "fresh-refresh",
          expires_in: 300,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  let ebonAttempts = 0;
  try {
    const client = new ReweClient({
      tokenStore: store,
      cache: new TtlCache({ enabled: false }),
      marketConfig: { marketId: "840174", zipCode: "68199", serviceType: "PICKUP" },
      fetchFn: async (url, init) => {
        if (url.includes("/api/ebons")) {
          ebonAttempts += 1;
        }
        if (init.headers?.Authorization === "Bearer stale-token") {
          return {
            ok: false,
            status: 401,
            buffer: async () => Buffer.from("Unauthorized"),
            text: async () => "Unauthorized",
            json: async () => ({}),
          };
        }
        assert.strictEqual(init.headers?.Authorization, "Bearer fresh-token");
        return {
          ok: true,
          status: 200,
          buffer: async () => Buffer.from("{}"),
          text: async () =>
            JSON.stringify({
              data: { getEbons: { items: [{ receiptId: "ebon-99", receiptTimestamp: "2026-11-12T10:00:00Z", receiptTotalPrice: 1200 }] } },
            }),
          json: async () => ({}),
        };
      },
    });

    const ebons = await client.listEbons();
    assert.strictEqual(ebonAttempts, 2);
    assert.strictEqual(tokenRefreshCalls, 1);
    assert.strictEqual(ebons.receipts[0].id, "ebon-99");
    assert.strictEqual(store.load()?.access_token, "fresh-token");
  } finally {
    globalThis.fetch = origFetch;
  }
});
