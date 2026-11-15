import test from "node:test";
import assert from "node:assert/strict";
import {
  centsToEuros,
  mapBasket,
  mapBonusSummary,
  mapCoupon,
  mapEbonSummary,
  mapFavoriteList,
  mapMarketDetails,
  mapMarketDiscounts,
  mapMarketList,
  mapOrderDetail,
  mapProductDetail,
  mapProductRecalls,
  mapProductSummary,
  mapRecipeDetail,
  mapRecipeSummary,
  mapServicePortfolio,
  mapShopCategories,
  mapTimeslot,
  parseGermanPrice,
} from "../src/mappers.js";

test("parseGermanPrice and centsToEuros handle German currency formats and cents", () => {
  assert.strictEqual(parseGermanPrice("1,99 €"), 1.99);
  assert.strictEqual(parseGermanPrice("ab 0,79€*"), 0.79);
  assert.strictEqual(parseGermanPrice("1.234,56 €"), 1234.56);
  assert.strictEqual(parseGermanPrice(2.5), 2.5);
  assert.strictEqual(parseGermanPrice(""), undefined);

  assert.strictEqual(centsToEuros(199), 1.99);
  assert.strictEqual(centsToEuros("459"), 4.59);
  assert.strictEqual(centsToEuros("1,49 €"), 1.49);
});

test("mapMarketList, mapMarketDetails, and mapServicePortfolio normalize market data", () => {
  const markets = mapMarketList({
    marketSearch: {
      markets: [
        {
          wwIdent: "840174",
          name: "REWE Markt",
          companyName: "REWE Markt Vuthaj oHG",
          street: "Rheingoldstr. 18-20",
          zipCode: "68199",
          city: "Mannheim / Neckarau",
          location: { latitude: 49.45, longitude: 8.48 },
          openingStatus: { openState: "OPEN", statusText: "Geöffnet", infoText: "bis 22:00 Uhr" },
          serviceFlags: { hasPickup: true },
        },
      ],
    },
  });
  assert.strictEqual(markets.length, 1);
  assert.strictEqual(markets[0].wwIdent, "840174");
  assert.strictEqual(markets[0].isOpen, true);
  assert.strictEqual(markets[0].hasPickup, true);

  const detail = mapMarketDetails({
    market: {
      wwIdent: "840174",
      name: "REWE Markt",
      phone: "0621-8414498",
      street: "Rheingoldstr. 18-20",
      zipCode: "68199",
      city: "Mannheim",
      openingInfo: [{ days: "Mo - Sa", hours: "07:00 - 22:00" }],
    },
    content: {
      services: {
        fixed: [{ text: "Parkplätze", active: true, tooltip: "100 Stellplätze" }],
      },
    },
  });
  assert.strictEqual(detail.phone, "0621-8414498");
  assert.strictEqual(detail.openingHours?.[0].days, "Mo - Sa");
  assert.strictEqual(detail.services?.[0].name, "Parkplätze");

  const portfolio = mapServicePortfolio(
    {
      servicePortfolio: {
        customerZipCode: "68199",
        deliveryMarket: { wwIdent: "840001" },
        pickupMarkets: [
          { wwIdent: "840174", displayName: "REWE Markt", zipCode: "68199", city: "Mannheim" },
        ],
      },
    },
    "68199"
  );
  assert.strictEqual(portfolio.deliveryMarketId, "840001");
  assert.deepStrictEqual(portfolio.availableServiceTypes, ["DELIVERY", "PICKUP"]);
  assert.strictEqual(portfolio.pickupMarkets[0].wwIdent, "840174");
});

test("mapMarketDiscounts respects defaultWeek and normalizes prices/bonus/manufacturer", () => {
  const result = mapMarketDiscounts(
    {
      offers: {
        defaultWeek: "current",
        current: {
          untilDate: "2026-11-21",
          handoutUrl: "https://example.invalid/prospekt.pdf",
          categories: [
            {
              id: "cat-1",
              title: "Top-Angebote",
              order: 1,
              offers: [
                { cellType: "TEASER" },
                {
                  id: "off-1",
                  cellType: "DEFAULT",
                  title: "Haribo Goldbären",
                  subtitle: "versch. Sorten",
                  priceData: { price: "0,77 €", regularPrice: "1,19 €", discount: "-35%" },
                  rawValues: { nan: "123456", categoryTitle: "Süßwaren" },
                  loyaltyBonus: { bonusType: "cent", bonusValue: 20 },
                  detail: {
                    nutriScore: "D",
                    contents: [{ header: "Produktdetails", titles: ["Hersteller: HARIBO"] }],
                  },
                },
              ],
            },
          ],
        },
      },
    },
    "840174"
  );
  assert.strictEqual(result.validUntil, "2026-11-21");
  assert.strictEqual(result.totalOffers, 1);
  assert.strictEqual(result.categories[0].offers[0].price, 0.77);
  assert.strictEqual(result.categories[0].offers[0].loyaltyBonusEuros, 0.2);
  assert.strictEqual(result.categories[0].offers[0].manufacturer, "HARIBO");
  assert.strictEqual(result.categories[0].offers[0].nan, "123456");
});

test("mapProductSummary, mapProductDetail, mapShopCategories, mapProductRecalls", () => {
  const p = mapProductSummary({
    productId: "p-1",
    nan: "777",
    title: "REWE Bio Haferdrink Natur",
    listing: {
      listingId: "8-ABC-123",
      currentRetailPrice: 119,
      grammage: "1l",
      isAvailable: true,
    },
    attributes: { isOrganic: true, isVegan: true },
  });
  assert.strictEqual(p.price, 1.19);
  assert.strictEqual(p.listingId, "8-ABC-123");
  assert.strictEqual(p.isOrganic, true);

  const detail = mapProductDetail({
    product: [
      {
        productId: "p-1",
        title: "REWE Bio Haferdrink",
        ingredientStatement: "Wasser, Hafer* (11%)",
        allergenStatement: "Gluten",
        gtin: "4388860622000",
      },
    ],
  });
  assert.strictEqual(detail.ingredients, "Wasser, Hafer* (11%)");
  assert.strictEqual(detail.gtin, "4388860622000");

  const cats = mapShopCategories({
    categories: [{ id: "1", name: "Obst & Gemüse", slug: "obst-gemuese", productCount: 412 }],
  });
  assert.strictEqual(cats[0].slug, "obst-gemuese");

  const recalls = mapProductRecalls({
    productRecalls: {
      products: [{ subjectProduct: "Rückruf Test", subjectReason: "Fremdkörper", url: "https://rewe.de/r" }],
    },
  });
  assert.strictEqual(recalls[0].title, "Rückruf Test");
});

test("mapRecipeSummary and mapRecipeDetail normalize steps, ingredients, and difficulty", () => {
  const sum = mapRecipeSummary({
    id: "blt1",
    title: "Pasta Pomodoro",
    difficulty: 1,
    timeTotal: 20,
    detailUrl: "https://www.rewe.de/rezepte/pasta/",
  });
  assert.strictEqual(sum.difficulty, "Gering");
  assert.strictEqual(sum.durationMinutes, 20);

  const rec = mapRecipeDetail({
    recipeById: {
      id: "blt1",
      title: "Pasta Pomodoro",
      difficulty: 2,
      serving: { type: "portions", quantity: 4 },
      ingredients: [{ quantity: 500, unit: "g", name: "Spaghetti", displayName: "500 g Spaghetti" }],
      preparation: { steps: [{ description: "Wasser kochen." }] },
      nutrients: [{ title: "Energie", amount: 520, unit: "kcal" }],
    },
  });
  assert.strictEqual(rec.portions, 4);
  assert.strictEqual(rec.ingredients[0].rawText, "500 g Spaghetti");
  assert.strictEqual(rec.steps[0].stepNumber, 1);
  assert.strictEqual(rec.nutrition?.[0].amount, 520);
});

test("mapEbonSummary, mapOrderDetail, mapBonusSummary, mapCoupon, mapFavoriteList, mapBasket, mapTimeslot", () => {
  const ebon = mapEbonSummary({
    receiptId: "ebon-1",
    receiptTimestamp: "2026-11-10T17:15:00Z",
    receiptTotalPrice: 2345,
    bonusPriceInCent: 120,
    market: { wwIdent: "840174", name: "REWE Markt", city: "Mannheim" },
    cancelled: false,
  });
  assert.strictEqual(ebon.totalPrice, 23.45);
  assert.strictEqual(ebon.bonusEarned, 1.2);
  assert.strictEqual(ebon.localDate, "2026-11-10");

  const order = mapOrderDetail({
    orderDetails: {
      orderId: "ord-1",
      orderDate: "2026-11-08T10:00:00+01:00",
      orderValue: 3590,
      status: "COMPLETED",
      subOrders: [
        {
          lineItems: [
            { lineItemType: "PRODUCT", productId: "p-1", title: "Vollmilch", quantity: 2, price: 119, totalPrice: 238 },
          ],
        },
      ],
    },
  });
  assert.strictEqual(order.totalPrice, 35.9);
  assert.strictEqual(order.items[0].name, "Vollmilch");
  assert.strictEqual(order.items[0].unitPrice, 1.19);

  const bonus = mapBonusSummary({ balanceInCents: 650 }, { status: "GOLD" }, { points: 420 }, [{ id: "m1" }]);
  assert.strictEqual(bonus.balanceEuros, 6.5);
  assert.strictEqual(bonus.statusTier, "GOLD");
  assert.strictEqual(bonus.missionsCount, 1);

  const coupon = mapCoupon({ id: "c1", headline: "10% auf Obst", status: "ACTIVATED" });
  assert.strictEqual(coupon.activated, true);

  const fav = mapFavoriteList({
    id: "fav-1",
    name: "Wocheneinkauf",
    items: [{ itemId: "i1", productId: "p1", title: "Äpfel", listing: { listingId: "l1", currentRetailPrice: 299 } }],
  });
  assert.strictEqual(fav.items[0].price, 2.99);

  const basket = mapBasket(
    {
      basket: {
        id: "b-1",
        version: 3,
        serviceSelection: { wwIdent: "840174", serviceType: "PICKUP", zipCode: "68199" },
        summary: { articleCount: 1, articlePrice: 299, totalArticleQuantity: 2, totalPrice: 299 },
        lineItems: [
          { quantity: 2, price: 150, totalPrice: 299, product: { productId: "p1", title: "Kaffee", listing: { listingId: "l-k" } } },
        ],
      },
    },
    { marketId: "840174", zipCode: "68199", serviceType: "PICKUP" }
  );
  assert.strictEqual(basket.version, 3);
  assert.strictEqual(basket.totalPrice, 2.99);
  assert.strictEqual(basket.items[0].listingId, "l-k");

  const slot = mapTimeslot({
    id: "ts-1",
    startTime: "2026-11-16T10:00:00+01:00",
    endTime: "2026-11-16T12:00:00+01:00",
    serviceFee: 0,
  });
  assert.strictEqual(slot.formattedTime, "10:00–12:00");
  assert.strictEqual(slot.price, 0);
});
