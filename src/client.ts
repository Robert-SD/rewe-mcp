import * as crypto from "node:crypto";
import {
  HOST_CONFIG,
  MOBILE_USER_AGENT,
  authFetch,
  forceRefreshAccessToken,
  getAuthStatus,
  getOptionalAccessToken,
  getValidAccessToken,
  loadMarketConfig,
  loadTokens,
  saveMarketConfig,
  type AuthFetchOptions,
  type AuthFetchResponse,
  type TokenStore,
} from "./auth.js";
import { CacheStats, TtlCache, cacheKey, getSharedCache } from "./cache.js";
import { CACHE_TTL, cacheKeyFor, cachePolicyFor } from "./cache-policy.js";
import { ReweApiError, normalizeToolError, type ReweErrorCode } from "./errors.js";
import * as basket from "./services/basket.js";
import * as loyalty from "./services/loyalty.js";
import * as offers from "./services/offers.js";
import * as planner from "./services/planner.js";
import * as receipts from "./services/receipts.js";
import * as recipes from "./services/recipes.js";
import * as stores from "./services/stores.js";
import { HostKey, RequestOptions, ReweTransport } from "./services/transport.js";
import {
  AuthSessionStatus,
  BonusSummary,
  EbonSummary,
  FavoriteList,
  GroceryTripPlan,
  MarketConfig,
  MarketDetails,
  MarketDiscountsResult,
  MarketInfo,
  MemberProfile,
  ProductRecall,
  RegularProductsResult,
  ReweBasket,
  ReweCoupon,
  ReweDiscount,
  ReweOrderDetail,
  ReweOrderSummary,
  ReweProduct,
  ReweProductDetail,
  ReweRecipe,
  ReweRecipeDetail,
  ServicePortfolio,
  ServiceType,
  ShopCategory,
  Timeslot,
} from "./types.js";

export { CACHE_TTL, ReweApiError, normalizeToolError };
export type { ReweErrorCode };

export interface ReweClientOptions {
  hostOverrides?: Partial<Record<HostKey, string>>;
  cache?: TtlCache;
  tokenStore?: TokenStore;
  fetchFn?: (url: string, options: AuthFetchOptions) => Promise<AuthFetchResponse>;
  marketConfig?: MarketConfig;
}

function extractJwtSubject(jwt: string | undefined): string | undefined {
  if (!jwt) return undefined;
  const parts = jwt.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    );
    if (typeof payload?.sub === "string" && payload.sub) {
      return payload.sub;
    }
  } catch {
    // Opaque token
  }
  return undefined;
}

export class ReweClient {
  private readonly cache: TtlCache;
  private readonly hostOverrides: Partial<Record<HostKey, string>>;
  private readonly tokenStore?: TokenStore;
  private readonly fetchFn: (
    url: string,
    options: AuthFetchOptions
  ) => Promise<AuthFetchResponse>;
  private readonly rdfaId: string;
  private readonly instanaId: string;
  private overrideMarketConfig?: MarketConfig;
  private lastAuthScope: string | null = null;
  readonly transport: ReweTransport;

  constructor(
    overridesOrOptions?: Partial<Record<HostKey, string>> | ReweClientOptions,
    cache?: TtlCache
  ) {
    let opts: ReweClientOptions;
    if (
      overridesOrOptions &&
      ("hostOverrides" in overridesOrOptions ||
        "cache" in overridesOrOptions ||
        "tokenStore" in overridesOrOptions ||
        "fetchFn" in overridesOrOptions ||
        "marketConfig" in overridesOrOptions)
    ) {
      opts = overridesOrOptions as ReweClientOptions;
    } else {
      opts = {
        hostOverrides: (overridesOrOptions as Partial<Record<HostKey, string>>) ?? {},
        cache,
      };
    }

    this.hostOverrides = opts.hostOverrides ?? {};
    this.cache = opts.cache ?? cache ?? getSharedCache();
    this.tokenStore = opts.tokenStore;
    this.fetchFn = opts.fetchFn ?? authFetch;
    this.overrideMarketConfig = opts.marketConfig;
    this.rdfaId = crypto.randomUUID();
    this.instanaId = crypto.randomUUID();

    this.transport = {
      request: (endpoint, options) => this.request(endpoint, options),
      requestBinary: (endpoint, options) => this.requestBinary(endpoint, options),
      getMarketConfig: () => this.getMarketConfig(),
      setMarketConfig: (update) => this.setMarketConfig(update),
      invalidateCache: (prefix) => this.cache.invalidate(prefix),
    };
  }

  cacheStats(): CacheStats {
    return this.cache.stats();
  }

  getMarketConfig(): MarketConfig {
    return this.overrideMarketConfig ?? loadMarketConfig();
  }

  setMarketConfig(update: Partial<MarketConfig>): MarketConfig {
    if (this.overrideMarketConfig) {
      this.overrideMarketConfig = {
        ...this.overrideMarketConfig,
        ...update,
        updatedAt: new Date().toISOString(),
      };
      return this.overrideMarketConfig;
    }
    return saveMarketConfig(update);
  }

  async getAuthStatus(): Promise<AuthSessionStatus> {
    return getAuthStatus(this.tokenStore);
  }

  resolveBaseUrl(host: HostKey = "mobile"): string {
    return this.hostOverrides[host] || HOST_CONFIG[host];
  }

  private async authScope(authMode: RequestOptions["authMode"]): Promise<string> {
    if (authMode === "none") return "anonymous";
    const tokens = await loadTokens(this.tokenStore);
    const principal =
      extractJwtSubject(tokens?.id_token) ||
      extractJwtSubject(tokens?.access_token) ||
      tokens?.refresh_token ||
      tokens?.access_token;
    const scope = principal
      ? cacheKey("auth", [principal]).split(" ").pop()!
      : "anonymous";
    if (this.lastAuthScope !== null && this.lastAuthScope !== scope) {
      this.cache.clear();
    }
    this.lastAuthScope = scope;
    return scope;
  }

  private buildUrl(baseUrl: string, endpoint: string, query?: Record<string, any>): string {
    let urlStr = endpoint.startsWith("http")
      ? endpoint
      : `${baseUrl.replace(/\/+$/, "")}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

    if (query) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (Array.isArray(v)) {
          for (const item of v) {
            if (item !== undefined && item !== null && item !== "") {
              sp.append(k, String(item));
            }
          }
        } else if (v !== undefined && v !== null && v !== "") {
          sp.append(k, String(v));
        }
      }
      const qs = sp.toString();
      if (qs) {
        urlStr += (urlStr.includes("?") ? "&" : "?") + qs;
      }
    }
    return urlStr;
  }

  private buildHeaders(
    host: HostKey,
    options: RequestOptions,
    authToken?: string
  ): Record<string, string> {
    const cfg = this.getMarketConfig();
    const marketId = options.marketId || cfg.marketId;
    const zipCode = options.zipCode || cfg.zipCode;
    const serviceType = options.serviceType || cfg.serviceType;

    const baseHeaders: Record<string, string> = {
      Accept: "application/json",
      "Accept-Language": "de-DE,de;q=0.9",
      "User-Agent": MOBILE_USER_AGENT,
      ...(host === "mobile" || host === "msco"
        ? {
            rdfa: this.rdfaId,
            "x-instana-android": this.instanaId,
            "correlation-id": crypto.randomUUID(),
            rdtga: "payment-enable-google-pay,productlist-citrusad",
            "rd-is-lsfk": "false",
            "rd-is-pickup-station": "false",
            "rd-user-consent": '{"conversionOptimization": 1}',
          }
        : {}),
      ...(options.includeMarketHeaders
        ? {
            "rd-market-id": marketId,
            "x-rd-market-id": marketId,
            "rd-service-types": serviceType,
            "x-rd-service-types": serviceType,
            "rd-customer-zip": zipCode,
            "x-rd-customer-zip": zipCode,
            "rd-postcode": zipCode,
          }
        : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    };

    return baseHeaders;
  }

  async request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const host = options.host ?? "mobile";
    const baseUrl = this.resolveBaseUrl(host);
    const authMode = options.authMode ?? "required";
    const cfg = this.getMarketConfig();

    const policy = cachePolicyFor(endpoint, {
      ...options,
      host,
      marketId: options.marketId || cfg.marketId,
      zipCode: options.zipCode || cfg.zipCode,
      serviceType: options.serviceType || cfg.serviceType,
    });

    if (policy === null) {
      return await this.performRequest<T>(endpoint, { ...options, host });
    }

    const token =
      authMode === "none"
        ? undefined
        : authMode === "optional"
          ? (await getOptionalAccessToken(this.tokenStore)) ?? undefined
          : await getValidAccessToken(this.tokenStore);
    const scope = await this.authScope(token ? authMode : "none");
    const key = cacheKeyFor(
      baseUrl,
      endpoint,
      {
        ...options,
        host,
        marketId: options.marketId || cfg.marketId,
        zipCode: options.zipCode || cfg.zipCode,
        serviceType: options.serviceType || cfg.serviceType,
      },
      scope
    );

    return await this.cache.wrap<T>(
      key,
      policy.ttl,
      () => this.performRequest<T>(endpoint, { ...options, host }, token),
      policy.shouldCache
    );
  }

  private async executeRaw(
    endpoint: string,
    options: RequestOptions,
    preResolvedToken?: string
  ): Promise<AuthFetchResponse> {
    const host = options.host ?? "mobile";
    const baseUrl = this.resolveBaseUrl(host);
    const authMode = options.authMode ?? "required";

    let authToken = preResolvedToken;
    if (!authToken && authMode === "required") {
      authToken = await getValidAccessToken(this.tokenStore);
    } else if (!authToken && authMode === "optional") {
      authToken = (await getOptionalAccessToken(this.tokenStore)) ?? undefined;
    }

    const method = (options.method || "GET").toUpperCase();
    const urlStr = this.buildUrl(baseUrl, endpoint, options.query);
    const useMtls = host === "mobile" || host === "msco";

    const sendOnce = async (token?: string) => {
      const headers = this.buildHeaders(host, options, token);
      let bodyStr: string | undefined;
      if (options.body !== undefined) {
        headers["Content-Type"] = headers["Content-Type"] || "application/json";
        bodyStr =
          typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      }
      return this.fetchFn(urlStr, {
        method,
        headers,
        body: bodyStr,
        useMtls,
      });
    };

    let resp = await sendOnce(authToken);

    // Refresh expired token once on 401
    if (resp.status === 401 && authMode !== "none") {
      try {
        const refreshed = await forceRefreshAccessToken(this.tokenStore);
        resp = await sendOnce(refreshed);
      } catch {
        // Fall through with original 401 response
      }
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw ReweApiError.fromHttpStatus(resp.status, errText, endpoint);
    }

    return resp;
  }

  private async performRequest<T = any>(
    endpoint: string,
    options: RequestOptions = {},
    preResolvedToken?: string
  ): Promise<T> {
    const resp = await this.executeRaw(endpoint, options, preResolvedToken);
    const text = await resp.text();
    if (!text) return undefined as T;

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return text as unknown as T;
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray(parsed.errors) &&
      parsed.errors.length > 0 &&
      (parsed.data === undefined || parsed.data === null)
    ) {
      throw new ReweApiError(
        "UPSTREAM_ERROR",
        String(parsed.errors[0]?.message || "REWE API returned errors"),
        502,
        endpoint,
        parsed.errors
      );
    }

    if (
      options.unwrapData !== false &&
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "data" in parsed &&
      parsed.data !== undefined
    ) {
      return parsed.data as T;
    }

    return parsed as T;
  }

  async requestBinary(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<Buffer> {
    const resp = await this.executeRaw(endpoint, options);
    return resp.buffer();
  }

  // 1. Account & Loyalty
  getProfile = (): Promise<MemberProfile> => loyalty.getProfile(this.transport);
  getBonusSummary = (): Promise<BonusSummary> => loyalty.getBonusSummary(this.transport);
  getBonusCoupons = (): Promise<ReweCoupon[]> => loyalty.getBonusCoupons(this.transport);
  getBonusTransactions = (limit?: number): Promise<unknown> =>
    loyalty.getBonusTransactions(this.transport, limit);

  // 2. Stores & Service Portfolio
  searchMarkets = (query: string): Promise<MarketInfo[]> =>
    stores.searchMarkets(this.transport, query);
  getMarketDetails = (marketId?: string): Promise<MarketDetails> =>
    stores.getMarketDetails(this.transport, marketId);
  getServicePortfolio = (zipCode?: string): Promise<ServicePortfolio> =>
    stores.getServicePortfolio(this.transport, zipCode);
  getBulkyGoodsConfig = (options?: {
    marketId?: string;
    serviceType?: ServiceType;
  }): Promise<unknown> => stores.getBulkyGoodsConfig(this.transport, options);
  getSelectedMarket = (): MarketConfig => stores.getSelectedMarket(this.transport);
  setSelectedMarket = (input: {
    marketId: string;
    zipCode?: string;
    serviceType?: ServiceType;
    marketName?: string;
    city?: string;
  }): Promise<MarketConfig> => stores.setSelectedMarket(this.transport, input);

  // 3. Offers, Products, Categories & Recalls
  getMarketDiscounts = (options?: {
    marketId?: string;
    zipCode?: string;
    categoryId?: string;
    limit?: number;
  }): Promise<MarketDiscountsResult> =>
    offers.getMarketDiscounts(this.transport, options);
  searchDiscounts = (
    query: string,
    options?: { marketId?: string; zipCode?: string; limit?: number }
  ): Promise<{
    marketId: string;
    query: string;
    validUntil?: string;
    totalMatches: number;
    offers: ReweDiscount[];
  }> => offers.searchDiscounts(this.transport, query, options);
  getStationaryHandout = (marketId?: string): Promise<unknown> =>
    offers.getStationaryHandout(this.transport, marketId);
  searchProducts = (options?: {
    query?: string;
    page?: number;
    objectsPerPage?: number;
    sort?: string;
    filters?: string[];
    categorySlug?: string;
    marketId?: string;
    zipCode?: string;
    serviceType?: ServiceType;
  }) => offers.searchProducts(this.transport, options);
  getProductDetails = (
    productId: string,
    options?: { marketId?: string; zipCode?: string; serviceType?: ServiceType }
  ): Promise<ReweProductDetail> =>
    offers.getProductDetails(this.transport, productId, options);
  getProductRecommendations = (
    listingIds: string[],
    options?: { marketId?: string; zipCode?: string; serviceType?: ServiceType }
  ): Promise<ReweProduct[]> =>
    offers.getProductRecommendations(this.transport, listingIds, options);
  getShopCategories = (options?: {
    marketId?: string;
    zipCode?: string;
    serviceType?: ServiceType;
  }): Promise<ShopCategory[]> => offers.getShopCategories(this.transport, options);
  getProductRecalls = (): Promise<ProductRecall[]> =>
    offers.getProductRecalls(this.transport);

  // 4. Recipes
  searchRecipes = (options?: {
    searchTerm?: string;
    objectsPerPage?: number;
    page?: number;
    sorting?: string;
    difficulty?: string;
    collection?: string;
    tags?: string[];
  }): Promise<{
    totalCount: number;
    recipes: ReweRecipe[];
    metadata?: unknown;
  }> => recipes.searchRecipes(this.transport, options);
  getRecipeDetails = (recipeId: string): Promise<ReweRecipeDetail> =>
    recipes.getRecipeDetails(this.transport, recipeId);
  getRecipePopularTerms = (): Promise<string[]> =>
    recipes.getRecipePopularTerms(this.transport);
  getFavoriteRecipes = (): Promise<unknown> =>
    recipes.getFavoriteRecipes(this.transport);

  // 5. Receipts (eBons) & Online Orders
  listEbons = (
    limit?: number
  ): Promise<{ ebonActive?: boolean; totalCount: number; receipts: EbonSummary[] }> =>
    receipts.listEbons(this.transport, limit);
  getEbonPdf = (ebonId: string, savePath?: string) =>
    receipts.getEbonPdf(this.transport, ebonId, savePath);
  listOrders = (limit?: number): Promise<ReweOrderSummary[]> =>
    receipts.listOrders(this.transport, limit);
  getOrderDetails = (orderId: string): Promise<ReweOrderDetail> =>
    receipts.getOrderDetails(this.transport, orderId);
  getPurchasedProducts = (options?: {
    page?: number;
    objectsPerPage?: number;
    filter?: string;
  }): Promise<ReweProduct[]> => receipts.getPurchasedProducts(this.transport, options);

  // 6. Favorites, Basket & Timeslots
  getFavorites = (options?: { includeProducts?: boolean }): Promise<FavoriteList[]> =>
    basket.getFavorites(this.transport, options);
  addFavorite = (
    listId: string,
    listingId: string,
    options?: { productId?: string; quantity?: number }
  ): Promise<FavoriteList> =>
    basket.addFavorite(this.transport, listId, listingId, options);
  removeFavorite = (listId: string, itemId: string) =>
    basket.removeFavorite(this.transport, listId, itemId);
  createOrGetBasket = (options?: {
    basketId?: string;
    marketId?: string;
    zipCode?: string;
    serviceType?: ServiceType;
  }): Promise<ReweBasket> => basket.createOrGetBasket(this.transport, options);
  setBasketItemQuantity = (options: {
    basketId?: string;
    listingId: string;
    quantity: number;
    version?: number;
    marketId?: string;
    zipCode?: string;
    serviceType?: ServiceType;
  }): Promise<ReweBasket> => basket.setBasketItemQuantity(this.transport, options);
  getTimeslots = (options?: {
    basketId?: string;
    marketId?: string;
    zipCode?: string;
    serviceType?: ServiceType;
  }): Promise<Timeslot[]> => basket.getTimeslots(this.transport, options);

  // 7. Regular Products & Trip Planner
  getRegularProducts = (
    options?: planner.GetRegularProductsOptions
  ): Promise<RegularProductsResult> =>
    planner.getRegularProducts(this.transport, options);
  planGroceryTrip = (
    options?: planner.PlanGroceryTripOptions
  ): Promise<GroceryTripPlan> => planner.planGroceryTrip(this.transport, options);
}
