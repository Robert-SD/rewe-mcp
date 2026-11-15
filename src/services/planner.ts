import { mapWithConcurrency } from "../concurrency.js";
import {
  GroceryTripPlan,
  MatchedCouponSummary,
  MatchedOfferSummary,
  RegularProductSummary,
  RegularProductsResult,
  ReweCoupon,
  ReweDiscount,
} from "../types.js";
import * as loyalty from "./loyalty.js";
import * as offers from "./offers.js";
import * as receipts from "./receipts.js";
import { ReweTransport } from "./transport.js";

const STOPWORDS = new Set([
  "rewe",
  "bio",
  "ja",
  "beste",
  "wahl",
  "feine",
  "welt",
  "klassik",
  "original",
  "classic",
  "fresh",
  "frisch",
  "frische",
  "und",
  "mit",
  "ohne",
  "fuer",
  "für",
  "der",
  "die",
  "das",
  "aus",
  "von",
  "vom",
  "im",
  "in",
  "zu",
  "zum",
  "zur",
  "pack",
  "packung",
  "beutel",
  "flasche",
  "glas",
  "dose",
]);

export function normalizeProductName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\b\d+\s*x\s*\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|cl|stk|st)?\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|mg|ml|l|cl|dl|stk|st|stueck)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeProductName(text)
    .split(" ")
    .filter((tok) => tok.length >= 3 && !STOPWORDS.has(tok));
}

function tokenMatchScore(aTokens: string[], bText: string, idsA?: string[], idB?: string): number {
  if (idB && idsA && idsA.includes(idB)) {
    return 1.0;
  }
  if (aTokens.length === 0) return 0;
  const bTokens = tokenize(bText);
  if (bTokens.length === 0) return 0;

  let hits = 0;
  for (const ta of aTokens) {
    if (bTokens.some((tb) => tb === ta || tb.includes(ta) || ta.includes(tb))) {
      hits += 1;
    }
  }
  if (hits === 0) return 0;

  const coverageA = hits / aTokens.length;
  const coverageB = hits / bTokens.length;
  return Number((coverageA * 0.7 + coverageB * 0.3).toFixed(3));
}

export interface GetRegularProductsOptions {
  maxOrders?: number;
  minPurchases?: number;
  limit?: number;
}

export async function getRegularProducts(
  t: ReweTransport,
  options: GetRegularProductsOptions = {}
): Promise<RegularProductsResult> {
  const maxOrders = Math.max(1, Math.min(40, options.maxOrders ?? 15));
  const minPurchases = Math.max(1, options.minPurchases ?? 1);
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));

  const [purchasedRes, ordersRes, ebonsRes] = await Promise.allSettled([
    receipts.getPurchasedProducts(t, { page: 1, objectsPerPage: 80 }),
    receipts.listOrders(t, maxOrders),
    receipts.listEbons(t, 30),
  ]);

  if (
    purchasedRes.status === "rejected" &&
    ordersRes.status === "rejected" &&
    ebonsRes.status === "rejected"
  ) {
    throw purchasedRes.reason;
  }

  const orderList = ordersRes.status === "fulfilled" ? ordersRes.value : [];
  const ordersToInspect = orderList.slice(0, maxOrders);
  const orderDetails = await mapWithConcurrency(ordersToInspect, 4, async (ord) => {
    try {
      return await receipts.getOrderDetails(t, ord.id);
    } catch {
      return null;
    }
  });

  interface Bucket {
    normalizedName: string;
    displayCounts: Map<string, number>;
    productIds: Set<string>;
    listingIds: Set<string>;
    nans: Set<string>;
    purchaseCount: number;
    totalQuantity: number;
    prices: number[];
    dates: Array<{ ts: number; iso: string; localDate?: string }>;
    sources: Set<string>;
  }

  const buckets = new Map<string, Bucket>();

  const getBucket = (rawTitle: string): Bucket | null => {
    const norm = normalizeProductName(rawTitle) || rawTitle.toLowerCase().trim();
    if (!norm) return null;
    let b = buckets.get(norm);
    if (!b) {
      b = {
        normalizedName: norm,
        displayCounts: new Map(),
        productIds: new Set(),
        listingIds: new Set(),
        nans: new Set(),
        purchaseCount: 0,
        totalQuantity: 0,
        prices: [],
        dates: [],
        sources: new Set(),
      };
      buckets.set(norm, b);
    }
    b.displayCounts.set(rawTitle, (b.displayCounts.get(rawTitle) ?? 0) + 1);
    return b;
  };

  for (const ord of orderDetails) {
    if (!ord) continue;
    const ordTs = ord.createdAt ? new Date(ord.createdAt).getTime() : NaN;
    for (const item of ord.items) {
      const b = getBucket(item.name);
      if (!b) continue;
      b.purchaseCount += 1;
      b.totalQuantity += item.quantity || 1;
      b.sources.add("order_history");
      if (item.productId) b.productIds.add(item.productId);
      if (item.listingId) b.listingIds.add(item.listingId);
      if (item.nan) b.nans.add(item.nan);
      const unitPrice =
        item.unitPrice ??
        (item.totalPrice !== undefined && item.quantity > 0
          ? Number((item.totalPrice / item.quantity).toFixed(2))
          : undefined);
      if (unitPrice !== undefined) b.prices.push(unitPrice);
      if (Number.isFinite(ordTs) && ord.createdAt) {
        b.dates.push({ ts: ordTs, iso: ord.createdAt, localDate: ord.localDate });
      }
    }
  }

  const purchased = purchasedRes.status === "fulfilled" ? purchasedRes.value : [];
  for (const prod of purchased) {
    const b = getBucket(prod.title);
    if (!b) continue;
    // `/api/purchased-products` proves at least 1 prior purchase if not already seen in orders
    if (b.purchaseCount === 0) {
      b.purchaseCount = 1;
      b.totalQuantity = 1;
    }
    b.sources.add("purchased_products");
    if (prod.id) b.productIds.add(prod.id);
    if (prod.listingId) b.listingIds.add(prod.listingId);
    if (prod.nan) b.nans.add(prod.nan);
    if (prod.price !== undefined) b.prices.push(prod.price);
  }

  const nowMs = Date.now();
  const summaries: RegularProductSummary[] = [];

  for (const b of buckets.values()) {
    if (b.purchaseCount < minPurchases) continue;
    const aliases = [...b.displayCounts.entries()]
      .sort((a, c) => c[1] - a[1])
      .map(([name]) => name);
    const displayName = aliases[0] || b.normalizedName;

    b.dates.sort((a, c) => c.ts - a.ts);
    const latest = b.dates[0];
    const daysSinceLastPurchase = latest
      ? Math.max(0, Math.floor((nowMs - latest.ts) / 86_400_000))
      : undefined;

    let averageCadenceDays: number | undefined;
    if (b.dates.length >= 2) {
      const oldest = b.dates[b.dates.length - 1];
      const spanDays = (latest.ts - oldest.ts) / 86_400_000;
      if (spanDays > 0) {
        averageCadenceDays = Number((spanDays / (b.dates.length - 1)).toFixed(1));
      }
    }

    const dueForRestock =
      daysSinceLastPurchase !== undefined &&
      averageCadenceDays !== undefined &&
      daysSinceLastPurchase >= averageCadenceDays * 0.85;

    const avgPrice =
      b.prices.length > 0
        ? Number((b.prices.reduce((s, p) => s + p, 0) / b.prices.length).toFixed(2))
        : undefined;

    summaries.push({
      normalizedName: b.normalizedName,
      displayName,
      aliases,
      productIds: [...b.productIds],
      listingIds: [...b.listingIds],
      nans: [...b.nans],
      purchaseCount: b.purchaseCount,
      totalQuantity: b.totalQuantity,
      ...(avgPrice !== undefined ? { averageUnitPrice: avgPrice } : {}),
      ...(b.prices[0] !== undefined ? { lastUnitPrice: b.prices[0] } : {}),
      ...(latest ? { lastPurchasedDate: latest.iso } : {}),
      ...(latest?.localDate ? { lastPurchasedLocalDate: latest.localDate } : {}),
      ...(daysSinceLastPurchase !== undefined ? { daysSinceLastPurchase } : {}),
      ...(averageCadenceDays !== undefined ? { averageCadenceDays } : {}),
      dueForRestock,
      sources: [...b.sources],
    });
  }

  summaries.sort((a, c) => {
    if (c.purchaseCount !== a.purchaseCount) return c.purchaseCount - a.purchaseCount;
    return (a.daysSinceLastPurchase ?? 9999) - (c.daysSinceLastPurchase ?? 9999);
  });

  const ebonsCount = ebonsRes.status === "fulfilled" ? ebonsRes.value.totalCount : 0;

  return {
    ordersAvailable: orderList.length,
    ordersAnalyzed: orderDetails.filter(Boolean).length,
    purchasedProductsCount: purchased.length,
    ebonsCount,
    minPurchases,
    totalUniqueItems: summaries.length,
    regularProducts: summaries.slice(0, limit),
    ...(ebonsCount > 0 && orderList.length === 0 && purchased.length === 0
      ? {
          note: "Digital eBons list was retrieved, while online order history is empty; itemized in-store products appear inside downloaded eBon PDFs or purchased-products.",
        }
      : {}),
  };
}

function matchAgainstOffersAndCoupons(
  itemLabel: string,
  nans: string[],
  allOffers: ReweDiscount[],
  allCoupons: ReweCoupon[]
): {
  matchingOffers: MatchedOfferSummary[];
  matchingCoupons: MatchedCouponSummary[];
} {
  const queryTokens = tokenize(itemLabel);
  const matchingOffers: MatchedOfferSummary[] = [];
  const matchingCoupons: MatchedCouponSummary[] = [];

  for (const offer of allOffers) {
    const score = tokenMatchScore(
      queryTokens,
      `${offer.title} ${offer.subtitle || ""} ${offer.categoryTitle || ""}`,
      nans,
      offer.nan
    );
    if (score >= 0.45) {
      matchingOffers.push({
        id: offer.id,
        title: offer.title,
        ...(offer.subtitle ? { subtitle: offer.subtitle } : {}),
        ...(offer.nan ? { nan: offer.nan } : {}),
        ...(offer.price !== undefined ? { price: offer.price } : {}),
        ...(offer.rawPrice ? { rawPrice: offer.rawPrice } : {}),
        ...(offer.discountLabel ? { discountLabel: offer.discountLabel } : {}),
        ...(offer.categoryTitle ? { categoryTitle: offer.categoryTitle } : {}),
        ...(offer.validUntil ? { validUntil: offer.validUntil } : {}),
        matchScore: score,
      });
    }
  }

  for (const coupon of allCoupons) {
    const score = tokenMatchScore(
      queryTokens,
      `${coupon.title} ${coupon.subtitle || ""} ${coupon.description || ""}`
    );
    if (score >= 0.45) {
      matchingCoupons.push({
        id: coupon.id,
        title: coupon.title,
        ...(coupon.subtitle ? { subtitle: coupon.subtitle } : {}),
        ...(coupon.discountText ? { discountText: coupon.discountText } : {}),
        activated: coupon.activated,
        ...(coupon.validUntil ? { validUntil: coupon.validUntil } : {}),
        matchScore: score,
      });
    }
  }

  matchingOffers.sort((a, b) => b.matchScore - a.matchScore);
  matchingCoupons.sort((a, b) => b.matchScore - a.matchScore);

  return {
    matchingOffers: matchingOffers.slice(0, 5),
    matchingCoupons: matchingCoupons.slice(0, 5),
  };
}

export interface PlanGroceryTripOptions {
  marketId?: string;
  zipCode?: string;
  maxOrders?: number;
  minPurchases?: number;
  extraItems?: string[];
  onlyDiscounted?: boolean;
}

export async function planGroceryTrip(
  t: ReweTransport,
  options: PlanGroceryTripOptions = {}
): Promise<GroceryTripPlan> {
  const cfg = t.getMarketConfig();
  const marketId = (options.marketId || cfg.marketId).trim();
  const zipCode = (options.zipCode || cfg.zipCode).trim();
  const minPurchases = Math.max(1, options.minPurchases ?? 1);

  const [regularsRes, discountsRes, couponsRes] = await Promise.allSettled([
    getRegularProducts(t, {
      maxOrders: options.maxOrders ?? 15,
      minPurchases,
      limit: 100,
    }),
    offers.getMarketDiscounts(t, { marketId, zipCode }),
    loyalty.getBonusCoupons(t),
  ]);

  const regulars =
    regularsRes.status === "fulfilled"
      ? regularsRes.value
      : {
          ordersAvailable: 0,
          ordersAnalyzed: 0,
          purchasedProductsCount: 0,
          ebonsCount: 0,
          minPurchases,
          totalUniqueItems: 0,
          regularProducts: [],
        };

  if (discountsRes.status === "rejected") {
    throw discountsRes.reason;
  }

  const allOffers = discountsRes.value.categories.flatMap((c) => c.offers);
  const allCoupons = couponsRes.status === "fulfilled" ? couponsRes.value : [];
  const couponsError =
    couponsRes.status === "rejected"
      ? (couponsRes.reason as Error)?.message || "Coupons unavailable"
      : undefined;

  const discountedRegulars: GroceryTripPlan["discountedRegulars"] = [];
  const dueForRestock: RegularProductSummary[] = [];
  const otherRegulars: RegularProductSummary[] = [];
  const unactivatedMap = new Map<
    string,
    { coupon: MatchedCouponSummary; items: Set<string> }
  >();

  const trackUnactivated = (c: MatchedCouponSummary, itemName: string) => {
    if (c.activated) return;
    let entry = unactivatedMap.get(c.id);
    if (!entry) {
      entry = { coupon: c, items: new Set() };
      unactivatedMap.set(c.id, entry);
    }
    entry.items.add(itemName);
  };

  for (const reg of regulars.regularProducts) {
    const { matchingOffers, matchingCoupons } = matchAgainstOffersAndCoupons(
      reg.displayName,
      reg.nans,
      allOffers,
      allCoupons
    );
    for (const c of matchingCoupons) {
      trackUnactivated(c, reg.displayName);
    }

    if (matchingOffers.length > 0 || matchingCoupons.length > 0) {
      discountedRegulars.push({
        regular: reg,
        matchingOffers,
        matchingCoupons,
      });
    } else if (!options.onlyDiscounted) {
      if (reg.dueForRestock) {
        dueForRestock.push(reg);
      } else {
        otherRegulars.push(reg);
      }
    }
  }

  const requestedItemDeals: GroceryTripPlan["requestedItemDeals"] = [];
  for (const rawQuery of options.extraItems || []) {
    const query = rawQuery.trim();
    if (!query) continue;
    const { matchingOffers, matchingCoupons } = matchAgainstOffersAndCoupons(
      query,
      [],
      allOffers,
      allCoupons
    );
    for (const c of matchingCoupons) {
      trackUnactivated(c, query);
    }
    requestedItemDeals.push({
      query,
      matchingOffers,
      matchingCoupons,
    });
  }

  const unactivatedMatchingCoupons = [...unactivatedMap.values()].map(
    ({ coupon, items }) => ({
      id: coupon.id,
      title: coupon.title,
      ...(coupon.discountText ? { discountText: coupon.discountText } : {}),
      ...(coupon.validUntil ? { validUntil: coupon.validUntil } : {}),
      matchedItems: [...items],
    })
  );

  return {
    marketId,
    zipCode,
    serviceType: cfg.serviceType,
    ordersAnalyzed: regulars.ordersAnalyzed,
    minPurchases,
    offersChecked: allOffers.length,
    couponsChecked: allCoupons.length,
    ...(couponsError ? { couponsError } : {}),
    discountedRegulars,
    requestedItemDeals,
    dueForRestock,
    otherRegulars,
    unactivatedMatchingCoupons,
    ...(regularsRes.status === "rejected"
      ? {
          note: `Regular purchase history unavailable (${(regularsRes.reason as Error)?.message || "unauthenticated"}); showing deals for requested extraItems only.`,
        }
      : regulars.note
        ? { note: regulars.note }
        : {}),
  };
}
