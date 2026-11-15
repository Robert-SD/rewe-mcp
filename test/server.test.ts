import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { TtlCache } from "../src/cache.js";
import { ReweApiError, ReweClient } from "../src/client.js";
import { normalizeToolError } from "../src/errors.js";
import { createServer } from "../src/index.js";
import { MemoryTokenStore, ReweAuthError } from "../src/token-store.js";

const EXPECTED_READ_ONLY_TOOLS = [
  "rewe_auth_status",
  "rewe_get_profile",
  "rewe_get_bonus",
  "rewe_get_coupons",
  "rewe_search_markets",
  "rewe_get_market_details",
  "rewe_get_service_portfolio",
  "rewe_get_selected_market",
  "rewe_get_discounts",
  "rewe_search_discounts",
  "rewe_get_brochure",
  "rewe_search_products",
  "rewe_get_product_details",
  "rewe_get_shop_categories",
  "rewe_get_product_recalls",
  "rewe_search_recipes",
  "rewe_get_recipe_details",
  "rewe_get_recipe_popular_terms",
  "rewe_list_ebons",
  "rewe_list_orders",
  "rewe_get_order_details",
  "rewe_get_favorites",
  "rewe_get_timeslots",
  "rewe_regular_products",
  "rewe_plan_grocery_trip",
];

const EXPECTED_STATEFUL_TOOLS = [
  "rewe_set_selected_market",
  "rewe_get_ebon_pdf",
  "rewe_manage_favorite",
  "rewe_get_basket",
  "rewe_set_basket_item",
];

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

test("createServer: registers all 30 rewe_* tools with schemas, annotations, and working handlers", async () => {
  const tokenStore = new MemoryTokenStore({
    access_token: "test-access-token",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });

  const reweClient = new ReweClient({
    cache: new TtlCache({ maxEntries: 50 }),
    tokenStore,
    marketConfig: { marketId: "840174", zipCode: "50667", serviceType: "PICKUP" },
    fetchFn: async (url, init) => {
      if (url.includes("/api/stationary-markets?search=")) {
        return jsonResponse({
          data: {
            marketSearch: {
              markets: [
                {
                  wwIdent: "840174",
                  name: "REWE Markt Köln",
                  street: "Hohe Str. 10",
                  zipCode: "50667",
                  city: "Köln",
                },
              ],
            },
          },
        });
      }
      if (url.includes("/api/stationary-offers/840174")) {
        return jsonResponse({
          data: {
            offers: {
              current: {
                untilDate: "2026-11-22",
                categories: [
                  {
                    id: "cat-1",
                    title: "Obst & Gemüse",
                    offers: [
                      {
                        id: "off-1",
                        title: "Bio Bananen",
                        priceData: { price: "1,79 €" },
                      },
                    ],
                  },
                ],
              },
            },
          },
        });
      }
      if (url.includes("/api/products?")) {
        return jsonResponse({
          data: {
            products: {
              products: [
                {
                  productId: "p-milch",
                  nan: "555111",
                  title: "REWE Beste Wahl Vollmilch",
                  listing: { listingId: "l-milch", currentRetailPrice: 115, grammage: "1l" },
                },
              ],
              pagination: { currentPage: 1, objectsPerPage: 30, pageCount: 1, objectCount: 1 },
            },
          },
        });
      }
      if (url.endsWith("/api/baskets") && (init.method || "GET") === "POST") {
        return jsonResponse({
          data: {
            basket: {
              id: "bsk-1",
              version: 3,
              serviceSelection: { wwIdent: "840174", zipCode: "50667", serviceType: "PICKUP" },
              summary: { articleCount: 0, totalArticleQuantity: 0, articlePrice: 0, totalPrice: 0 },
              lineItems: [],
            },
          },
        });
      }
      if (url.includes("/api/baskets/bsk-1/listings/l-milch")) {
        return jsonResponse({
          data: {
            basket: {
              id: "bsk-1",
              version: 4,
              serviceSelection: { wwIdent: "840174", zipCode: "50667", serviceType: "PICKUP" },
              summary: { articleCount: 1, totalArticleQuantity: 2, articlePrice: 230, totalPrice: 230 },
              lineItems: [
                {
                  quantity: 2,
                  price: 115,
                  totalPrice: 230,
                  product: {
                    productId: "p-milch",
                    title: "REWE Beste Wahl Vollmilch",
                    listing: { listingId: "l-milch", currentRetailPrice: 115 },
                  },
                },
              ],
            },
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const server = createServer(reweClient);
  const client = new Client({ name: "rewe-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 30);

    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of EXPECTED_READ_ONLY_TOOLS) {
      const tool = byName.get(name);
      assert.ok(tool, `Missing read-only tool ${name}`);
      assert.ok(tool.outputSchema, `Missing outputSchema on ${name}`);
      assert.equal(tool.annotations?.readOnlyHint, true, `${name} must have readOnlyHint: true`);
    }

    for (const name of EXPECTED_STATEFUL_TOOLS) {
      const tool = byName.get(name);
      assert.ok(tool, `Missing stateful tool ${name}`);
      assert.ok(tool.outputSchema, `Missing outputSchema on ${name}`);
      assert.equal(tool.annotations?.readOnlyHint, false, `${name} must have readOnlyHint: false`);
      assert.equal(tool.annotations?.destructiveHint, false, `${name} must have destructiveHint: false`);
      assert.equal(tool.annotations?.idempotentHint, true, `${name} must have idempotentHint: true`);
    }

    const marketsRes = await client.callTool({
      name: "rewe_search_markets",
      arguments: { query: "Köln" },
    });
    assert.equal(Boolean(marketsRes.isError), false);
    assert.equal((marketsRes.structuredContent as any).count, 1);
    assert.equal((marketsRes.structuredContent as any).markets[0].wwIdent, "840174");

    const discountsRes = await client.callTool({
      name: "rewe_get_discounts",
      arguments: { marketId: "840174" },
    });
    assert.equal(Boolean(discountsRes.isError), false);
    assert.equal((discountsRes.structuredContent as any).totalOffers, 1);

    const productsRes = await client.callTool({
      name: "rewe_search_products",
      arguments: { query: "Vollmilch" },
    });
    assert.equal(Boolean(productsRes.isError), false);
    assert.equal((productsRes.structuredContent as any).products[0].listingId, "l-milch");

    const basketRes = await client.callTool({
      name: "rewe_get_basket",
      arguments: {},
    });
    assert.equal(Boolean(basketRes.isError), false);
    assert.equal((basketRes.structuredContent as any).id, "bsk-1");

    const updateBasketRes = await client.callTool({
      name: "rewe_set_basket_item",
      arguments: { listingId: "l-milch", quantity: 2, basketId: "bsk-1", version: 3 },
    });
    assert.equal(Boolean(updateBasketRes.isError), false);
    assert.equal((updateBasketRes.structuredContent as any).totalQuantity, 2);
    assert.equal((updateBasketRes.structuredContent as any).totalPrice, 2.3);
  } finally {
    await client.close();
    await server.close();
  }
});

test("normalizeToolError: maps REWE API, Auth, mTLS, Rate Limit, and Input errors consistently", () => {
  const notFound = normalizeToolError(
    ReweApiError.fromHttpStatus(404, JSON.stringify({ message: "Market not found" }), "/api/stationary-markets/0")
  );
  assert.equal(notFound.code, "NOT_FOUND");
  assert.equal(notFound.status, 404);
  assert.equal(notFound.retryable, false);

  const mtls403 = normalizeToolError(
    ReweApiError.fromHttpStatus(403, "<html><body>Cloudflare SSL certificate required</body></html>", "/api/products")
  );
  assert.equal(mtls403.code, "MTLS_REQUIRED");
  assert.equal(mtls403.status, 403);
  assert.equal(mtls403.retryable, false);

  const authErr = normalizeToolError(new ReweAuthError("UNAUTHENTICATED", "Run npm run login"));
  assert.equal(authErr.code, "AUTH_REQUIRED");
  assert.equal(authErr.retryable, false);

  const rateLimited = normalizeToolError(
    ReweApiError.fromHttpStatus(429, JSON.stringify({ detail: "Too Many Requests" }), "/api/ebons")
  );
  assert.equal(rateLimited.code, "RATE_LIMITED");
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.retryable, true);

  const invalidInput = normalizeToolError(new ReweApiError("INVALID_INPUT", "marketId must not be empty."));
  assert.equal(invalidInput.code, "INVALID_INPUT");
  assert.equal(invalidInput.retryable, false);
});
