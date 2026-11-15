import { cacheKey } from "./cache.js";

export const CACHE_TTL = {
  /** Bonus balance, coupons, orders, eBons: short TTL, invalidated on writes. */
  liveList: 2 * 60 * 1000,
  /** eBon/order list & purchased products. */
  receipts: 5 * 60 * 1000,
  /** Product search and detail results. */
  products: 15 * 60 * 1000,
  /** Weekly stationary market offers/discounts and handouts. */
  offers: 30 * 60 * 1000,
  /** Profile info & recipes & service portfolio. */
  medium: 6 * 60 * 60 * 1000,
  /** Market details (opening hours, services). */
  marketDetail: 12 * 60 * 60 * 1000,
  /** Stationary market search, shop categories, recalls. */
  catalog: 24 * 60 * 60 * 1000,
} as const;

export interface CacheRule {
  ttl: number;
  shouldCache?: (payload: any) => boolean;
}

export interface RequestCacheInput {
  host?: string;
  method?: string;
  body?: any;
  query?: Record<string, any>;
  headers?: Record<string, string>;
  marketId?: string;
  zipCode?: string;
  serviceType?: string;
}

const NON_EMPTY_OBJECT = (payload: any): boolean =>
  Boolean(payload && typeof payload === "object");

const GET_CACHE_POLICIES: Array<{
  host?: string;
  pattern: RegExp;
  rule: CacheRule;
}> = [
  // Markets & service portfolio
  {
    host: "mobile",
    pattern: /^\/api\/stationary-markets$/i,
    rule: { ttl: CACHE_TTL.catalog, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/stationary-markets\/[^/]+$/i,
    rule: { ttl: CACHE_TTL.marketDetail, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/service-portfolio\/[^/]+$/i,
    rule: { ttl: CACHE_TTL.medium, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/bulky-goods-configuration\//i,
    rule: { ttl: CACHE_TTL.marketDetail, shouldCache: NON_EMPTY_OBJECT },
  },
  // Offers & handouts
  {
    host: "mobile",
    pattern: /^\/api\/stationary-offers\//i,
    rule: { ttl: CACHE_TTL.offers, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/stationary-handout\//i,
    rule: { ttl: CACHE_TTL.offers, shouldCache: NON_EMPTY_OBJECT },
  },
  // Products, recommendations, categories, recalls
  {
    host: "mobile",
    pattern: /^\/api\/products$/i,
    rule: { ttl: CACHE_TTL.products, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/products\/recalls$/i,
    rule: { ttl: CACHE_TTL.offers, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/products\/recommendations$/i,
    rule: { ttl: CACHE_TTL.products, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/products\/[^/]+$/i,
    rule: { ttl: CACHE_TTL.products, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/shop-overview$/i,
    rule: { ttl: CACHE_TTL.catalog, shouldCache: NON_EMPTY_OBJECT },
  },
  // Recipes
  {
    host: "mobile",
    pattern: /^\/api\/recipes\/search$/i,
    rule: { ttl: CACHE_TTL.medium, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/recipes\/search\/landing-page$/i,
    rule: { ttl: CACHE_TTL.medium, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/recipes\/[^/]+$/i,
    rule: { ttl: CACHE_TTL.medium, shouldCache: NON_EMPTY_OBJECT },
  },
  // Account, bonus, coupons, receipts
  {
    host: "account",
    pattern: /^\/realms\/sso\/protocol\/openid-connect\/userinfo$/i,
    rule: { ttl: CACHE_TTL.offers, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/(customers|rewe-id)$/i,
    rule: { ttl: CACHE_TTL.offers, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/bonus\//i,
    rule: { ttl: CACHE_TTL.liveList, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/loyalty-points\//i,
    rule: { ttl: CACHE_TTL.liveList, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/ebons$/i,
    rule: { ttl: CACHE_TTL.receipts, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/ebon-status$/i,
    rule: { ttl: CACHE_TTL.receipts, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/orders\/history$/i,
    rule: { ttl: CACHE_TTL.receipts, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/orders\/[^/]+$/i,
    rule: { ttl: CACHE_TTL.offers, shouldCache: NON_EMPTY_OBJECT },
  },
  {
    host: "mobile",
    pattern: /^\/api\/purchased-products$/i,
    rule: { ttl: CACHE_TTL.receipts, shouldCache: NON_EMPTY_OBJECT },
  },
];

export function cachePolicyFor(
  endpoint: string,
  options: RequestCacheInput
): CacheRule | null {
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET") return null;
  if (endpoint.startsWith("http")) return null;

  for (const entry of GET_CACHE_POLICIES) {
    if (entry.host && options.host && entry.host !== options.host) continue;
    if (entry.host && !options.host) continue;
    if (entry.pattern.test(endpoint)) {
      return entry.rule;
    }
  }
  return null;
}

export function cacheKeyFor(
  baseUrl: string,
  endpoint: string,
  options: RequestCacheInput,
  scope: string
): string {
  const method = (options.method || "GET").toUpperCase();
  const marketId = options.marketId || options.headers?.["rd-market-id"] || "";
  const zipCode = options.zipCode || options.headers?.["rd-postcode"] || "";
  const serviceType = options.serviceType || options.headers?.["rd-service-types"] || "";

  if (method === "GET") {
    const query = Object.entries(options.query ?? {})
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(
        ([k, v]) =>
          [k, Array.isArray(v) ? v.map(String) : String(v)] as [
            string,
            string | string[],
          ]
      )
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    return cacheKey(`${method} ${endpoint}`, [
      baseUrl,
      scope,
      marketId,
      zipCode,
      serviceType,
      query,
    ]);
  }

  return cacheKey(`${method} ${endpoint}`, [
    baseUrl,
    scope,
    marketId,
    zipCode,
    serviceType,
    options.body ?? {},
  ]);
}
