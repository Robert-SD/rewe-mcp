import assert from "node:assert/strict";
import test from "node:test";
import { TtlCache } from "../src/cache.js";
import { ReweClient } from "../src/client.js";
import {
  getRegularProducts,
  normalizeProductName,
  planGroceryTrip,
} from "../src/services/planner.js";
import { MemoryTokenStore } from "../src/token-store.js";

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

test("normalizeProductName: folds umlauts and strips package weights", () => {
  assert.equal(normalizeProductName("REWE Bio Vollmilch 3,8% 1L"), "rewe bio vollmilch 3 8");
  assert.equal(normalizeProductName("Käse-Brötchen 4 x 75 g"), "kaese broetchen");
  assert.equal(normalizeProductName("Süßer Senf 250ml"), "suesser senf");
});

test("getRegularProducts: aggregates purchased products and order history with cadence", async () => {
  const tokenStore = new MemoryTokenStore({
    access_token: "test-access-token",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });

  const now = Date.now();
  const daysAgoIso = (days: number) => new Date(now - days * 86_400_000).toISOString();

  const client = new ReweClient({
    cache: new TtlCache({ maxEntries: 50 }),
    tokenStore,
    marketConfig: { marketId: "840174", zipCode: "50667", serviceType: "PICKUP" },
    fetchFn: async (url) => {
      if (url.includes("/api/purchased-products")) {
        return jsonResponse({
          data: {
            purchasedProducts: {
              products: [
                {
                  productId: "p-oat",
                  nan: "100100",
                  title: "REWE Bio Haferdrink 1L",
                  listing: { listingId: "l-oat", currentRetailPrice: 129 },
                },
                {
                  productId: "p-bread",
                  nan: "200200",
                  title: "Harry Vollkornbrot 500g",
                  listing: { listingId: "l-bread", currentRetailPrice: 199 },
                },
              ],
            },
          },
        });
      }
      if (url.includes("/api/orders/history")) {
        return jsonResponse({
          data: {
            orderHistory: {
              orders: [
                { orderId: "ord-2", orderDate: daysAgoIso(15), serviceType: "PICKUP", orderValue: 1000 },
                { orderId: "ord-1", orderDate: daysAgoIso(30), serviceType: "PICKUP", orderValue: 1000 },
                { orderId: "ord-3", orderDate: daysAgoIso(1), serviceType: "PICKUP", orderValue: 500 },
              ],
            },
          },
        });
      }
      if (url.includes("/api/orders/ord-1")) {
        return jsonResponse({
          data: {
            orderDetails: {
              orderId: "ord-1",
              orderDate: daysAgoIso(30),
              subOrders: [
                {
                  lineItems: [
                    {
                      productId: "p-oat",
                      listingId: "l-oat",
                      nan: "100100",
                      title: "REWE Bio Haferdrink 1L",
                      quantity: 2,
                      price: 129,
                      totalPrice: 258,
                    },
                  ],
                },
              ],
            },
          },
        });
      }
      if (url.includes("/api/orders/ord-2")) {
        return jsonResponse({
          data: {
            orderDetails: {
              orderId: "ord-2",
              orderDate: daysAgoIso(15),
              subOrders: [
                {
                  lineItems: [
                    {
                      productId: "p-oat",
                      listingId: "l-oat",
                      nan: "100100",
                      title: "REWE Bio Haferdrink 1L",
                      quantity: 3,
                      price: 139,
                      totalPrice: 417,
                    },
                    {
                      productId: "p-coffee",
                      listingId: "l-coffee",
                      nan: "300300",
                      title: "Melitta Filterkaffee 500g",
                      quantity: 1,
                      price: 549,
                      totalPrice: 549,
                    },
                  ],
                },
              ],
            },
          },
        });
      }
      if (url.includes("/api/orders/ord-3")) {
        return jsonResponse({
          data: {
            orderDetails: {
              orderId: "ord-3",
              orderDate: daysAgoIso(1),
              subOrders: [
                {
                  lineItems: [
                    {
                      productId: "p-coffee",
                      listingId: "l-coffee",
                      nan: "300300",
                      title: "Melitta Filterkaffee 500g",
                      quantity: 1,
                      price: 549,
                      totalPrice: 549,
                    },
                  ],
                },
              ],
            },
          },
        });
      }
      if (url.includes("/api/ebons")) {
        return jsonResponse({ data: { getEbons: { items: [{ receiptId: "eb-1", receiptTimestamp: daysAgoIso(2), receiptTotalPrice: 999 }] } } });
      }
      if (url.includes("/api/ebon-status")) {
        return jsonResponse({ ebonStatus: { active: true } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const result = await getRegularProducts(client, { maxOrders: 10, minPurchases: 1 });
  assert.equal(result.ordersAvailable, 3);
  assert.equal(result.ordersAnalyzed, 3);
  assert.equal(result.purchasedProductsCount, 2);
  assert.equal(result.ebonsCount, 1);

  const oat = result.regularProducts.find((p) => p.nans.includes("100100"));
  assert.ok(oat, "Expected oat milk regular product");
  assert.equal(oat.purchaseCount, 2);
  assert.equal(oat.totalQuantity, 5);
  assert.equal(oat.averageCadenceDays, 15);
  assert.equal(oat.dueForRestock, true);

  const coffee = result.regularProducts.find((p) => p.nans.includes("300300"));
  assert.ok(coffee, "Expected coffee regular product");
  assert.equal(coffee.purchaseCount, 2);
  assert.equal(coffee.dueForRestock, false);

  const filtered = await getRegularProducts(client, { minPurchases: 2 });
  assert.equal(filtered.regularProducts.some((p) => p.nans.includes("200200")), false);
});

test("planGroceryTrip: matches offers by NAN and token overlap plus unactivated coupons", async () => {
  const tokenStore = new MemoryTokenStore({
    access_token: "test-access-token",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });

  const now = Date.now();
  const daysAgoIso = (days: number) => new Date(now - days * 86_400_000).toISOString();

  const client = new ReweClient({
    cache: new TtlCache({ maxEntries: 50 }),
    tokenStore,
    marketConfig: { marketId: "840174", zipCode: "50667", serviceType: "PICKUP" },
    fetchFn: async (url) => {
      if (url.includes("/api/purchased-products")) {
        return jsonResponse({ data: { purchasedProducts: { products: [] } } });
      }
      if (url.includes("/api/orders/history")) {
        return jsonResponse({
          data: {
            orderHistory: {
              orders: [
                { orderId: "o1", orderDate: daysAgoIso(30), serviceType: "PICKUP", orderValue: 500 },
                { orderId: "o2", orderDate: daysAgoIso(15), serviceType: "PICKUP", orderValue: 500 },
              ],
            },
          },
        });
      }
      if (url.includes("/api/orders/o1")) {
        return jsonResponse({
          data: {
            orderDetails: {
              orderId: "o1",
              orderDate: daysAgoIso(30),
              subOrders: [
                {
                  lineItems: [
                    { productId: "p1", nan: "111222", title: "Kerrygold Original Butter 250g", quantity: 1, price: 249, totalPrice: 249 },
                    { productId: "p2", nan: "999888", title: "Alpro Barista Haferdrink 1L", quantity: 1, price: 229, totalPrice: 229 },
                  ],
                },
              ],
            },
          },
        });
      }
      if (url.includes("/api/orders/o2")) {
        return jsonResponse({
          data: {
            orderDetails: {
              orderId: "o2",
              orderDate: daysAgoIso(15),
              subOrders: [
                {
                  lineItems: [
                    { productId: "p1", nan: "111222", title: "Kerrygold Original Butter 250g", quantity: 1, price: 249, totalPrice: 249 },
                    { productId: "p2", nan: "999888", title: "Alpro Barista Haferdrink 1L", quantity: 1, price: 229, totalPrice: 229 },
                  ],
                },
              ],
            },
          },
        });
      }
      if (url.includes("/api/ebons")) {
        return jsonResponse({ data: { getEbons: { items: [] } } });
      }
      if (url.includes("/api/ebon-status")) {
        return jsonResponse({ ebonStatus: { active: true } });
      }
      if (url.includes("/api/stationary-offers/840174")) {
        return jsonResponse({
          data: {
            offers: {
              current: {
                untilDate: "2026-11-22",
                categories: [
                  {
                    id: "c1",
                    title: "Kühlregal",
                    offers: [
                      {
                        id: "off-butter",
                        title: "Kerrygold Extra",
                        subtitle: "250g",
                        rawValues: { nan: "111222" },
                        priceData: { price: "1,79 €", regularPrice: "2,49 €", discount: "-28%" },
                      },
                      {
                        id: "off-bananas",
                        title: "Chiquita Bananen",
                        subtitle: "1kg",
                        priceData: { price: "1,49 €" },
                      },
                    ],
                  },
                ],
              },
            },
          },
        });
      }
      if (url.includes("/api/bonus/coupons")) {
        return jsonResponse({
          coupons: [
            {
              id: "cpn-butter",
              headline: "0,50 € Bonus auf Kerrygold Butter",
              discountText: "0,50 € Bonus",
              activated: false,
              validUntil: "2026-11-30",
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const plan = await planGroceryTrip(client, {
    marketId: "840174",
    zipCode: "50667",
    extraItems: ["Chiquita Bananen"],
  });

  assert.equal(plan.marketId, "840174");
  assert.equal(plan.offersChecked, 2);
  assert.equal(plan.couponsChecked, 1);

  assert.equal(plan.discountedRegulars.length, 1);
  assert.equal(plan.discountedRegulars[0].regular.nans[0], "111222");
  assert.equal(plan.discountedRegulars[0].matchingOffers[0].id, "off-butter");
  assert.equal(plan.discountedRegulars[0].matchingOffers[0].matchScore, 1);
  assert.equal(plan.discountedRegulars[0].matchingCoupons[0].id, "cpn-butter");

  assert.equal(plan.dueForRestock.length, 1);
  assert.equal(plan.dueForRestock[0].nans[0], "999888");

  assert.equal(plan.requestedItemDeals.length, 1);
  assert.equal(plan.requestedItemDeals[0].query, "Chiquita Bananen");
  assert.equal(plan.requestedItemDeals[0].matchingOffers[0].id, "off-bananas");

  assert.equal(plan.unactivatedMatchingCoupons.length, 1);
  assert.equal(plan.unactivatedMatchingCoupons[0].id, "cpn-butter");
});
