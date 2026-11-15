import { ReweApiError } from "../errors.js";
import {
  mapMarketDiscounts,
  mapProductDetail,
  mapProductRecalls,
  mapProductSummary,
  mapShopCategories,
} from "../mappers.js";
import {
  MarketDiscountsResult,
  ProductRecall,
  ReweDiscount,
  ReweProduct,
  ReweProductDetail,
  ServiceType,
  ShopCategory,
} from "../types.js";
import { ReweTransport } from "./transport.js";

export async function getMarketDiscounts(
  t: ReweTransport,
  options: {
    marketId?: string;
    zipCode?: string;
    categoryId?: string;
    limit?: number;
  } = {}
): Promise<MarketDiscountsResult> {
  const cfg = t.getMarketConfig();
  const marketId = (options.marketId || cfg.marketId).trim();
  const zipCode = (options.zipCode || cfg.zipCode).trim();

  const data = await t.request<any>(
    `/api/stationary-offers/${encodeURIComponent(marketId)}`,
    {
      host: "mobile",
      authMode: "none",
      marketId,
      zipCode,
      includeMarketHeaders: true,
    }
  );

  const mapped = mapMarketDiscounts(data, marketId);
  let categories = mapped.categories;
  if (options.categoryId) {
    const needle = options.categoryId.trim().toLowerCase();
    categories = categories.filter(
      (c) => c.id.toLowerCase() === needle || c.title.toLowerCase().includes(needle)
    );
  }
  if (options.limit && options.limit > 0) {
    let remaining = options.limit;
    categories = categories
      .map((c) => {
        if (remaining <= 0) return null;
        const sliced = c.offers.slice(0, remaining);
        remaining -= sliced.length;
        return {
          ...c,
          offerCount: sliced.length,
          offers: sliced,
        };
      })
      .filter((c): c is NonNullable<typeof c> => Boolean(c && c.offers.length > 0));
  }

  return {
    ...mapped,
    categories,
    totalOffers: categories.reduce((sum, c) => sum + c.offers.length, 0),
  };
}

export async function searchDiscounts(
  t: ReweTransport,
  query: string,
  options: { marketId?: string; zipCode?: string; limit?: number } = {}
): Promise<{
  marketId: string;
  query: string;
  validUntil?: string;
  totalMatches: number;
  offers: ReweDiscount[];
}> {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new ReweApiError("INVALID_INPUT", "Discount search query must not be empty.");
  }

  const discounts = await getMarketDiscounts(t, {
    marketId: options.marketId,
    zipCode: options.zipCode,
  });

  const matched: ReweDiscount[] = [];
  for (const cat of discounts.categories) {
    for (const offer of cat.offers) {
      const hay = `${offer.title} ${offer.subtitle || ""} ${offer.categoryTitle || ""} ${offer.manufacturer || ""}`.toLowerCase();
      if (tokens.every((tok) => hay.includes(tok))) {
        matched.push(offer);
      }
    }
  }

  const limited =
    options.limit && options.limit > 0 ? matched.slice(0, options.limit) : matched;

  return {
    marketId: discounts.marketId,
    query: query.trim(),
    ...(discounts.validUntil ? { validUntil: discounts.validUntil } : {}),
    totalMatches: matched.length,
    offers: limited,
  };
}

export async function getStationaryHandout(
  t: ReweTransport,
  marketId?: string
): Promise<unknown> {
  const resolvedId = (marketId || t.getMarketConfig().marketId).trim();
  return t.request<any>(
    `/api/stationary-handout/${encodeURIComponent(resolvedId)}`,
    {
      host: "mobile",
      authMode: "none",
      marketId: resolvedId,
      includeMarketHeaders: true,
    }
  );
}

export async function searchProducts(
  t: ReweTransport,
  options: {
    query?: string;
    page?: number;
    objectsPerPage?: number;
    sort?: string;
    filters?: string[];
    categorySlug?: string;
    marketId?: string;
    zipCode?: string;
    serviceType?: ServiceType;
  } = {}
): Promise<{
  marketId: string;
  serviceType: ServiceType;
  page: number;
  objectsPerPage: number;
  totalPages?: number;
  totalProducts?: number;
  correctedQuery?: string;
  products: ReweProduct[];
}> {
  const cfg = t.getMarketConfig();
  const marketId = (options.marketId || cfg.marketId).trim();
  const zipCode = (options.zipCode || cfg.zipCode).trim();
  const serviceType = options.serviceType || cfg.serviceType;
  const page = Math.max(1, options.page ?? 1);
  const objectsPerPage = Math.max(1, Math.min(80, options.objectsPerPage ?? 30));

  const data = await t.request<any>("/api/products", {
    host: "mobile",
    authMode: "none",
    marketId,
    zipCode,
    serviceType,
    includeMarketHeaders: true,
    query: {
      query: options.query ?? "",
      page,
      objectsPerPage,
      ...(options.categorySlug ? { categorySlug: options.categorySlug } : {}),
      ...(options.sort ? { sorting: options.sort } : {}),
      ...(options.filters?.length ? { filters: options.filters } : {}),
    },
  });

  const block = data?.products || data || {};
  const rawList: any[] = Array.isArray(block.products)
    ? block.products
    : Array.isArray(block)
      ? block
      : [];

  return {
    marketId,
    serviceType,
    page: block.pagination?.currentPage ?? page,
    objectsPerPage: block.pagination?.objectsPerPage ?? objectsPerPage,
    ...(typeof block.pagination?.pageCount === "number"
      ? { totalPages: block.pagination.pageCount }
      : {}),
    ...(typeof block.pagination?.objectCount === "number"
      ? { totalProducts: block.pagination.objectCount }
      : {}),
    ...(block.search?.term?.corrected
      ? { correctedQuery: String(block.search.term.corrected) }
      : {}),
    products: rawList.map(mapProductSummary),
  };
}

export async function getProductDetails(
  t: ReweTransport,
  productId: string,
  options: {
    marketId?: string;
    zipCode?: string;
    serviceType?: ServiceType;
  } = {}
): Promise<ReweProductDetail> {
  const id = productId.trim();
  if (!id) {
    throw new ReweApiError("INVALID_INPUT", "productId must not be empty.");
  }
  const cfg = t.getMarketConfig();
  const marketId = (options.marketId || cfg.marketId).trim();
  const zipCode = (options.zipCode || cfg.zipCode).trim();
  const serviceType = options.serviceType || cfg.serviceType;

  const data = await t.request<any>(
    `/api/products/${encodeURIComponent(id)}`,
    {
      host: "mobile",
      authMode: "none",
      marketId,
      zipCode,
      serviceType,
      includeMarketHeaders: true,
    }
  );
  return mapProductDetail(data);
}

export async function getProductRecommendations(
  t: ReweTransport,
  listingIds: string[],
  options: {
    marketId?: string;
    zipCode?: string;
    serviceType?: ServiceType;
  } = {}
): Promise<ReweProduct[]> {
  if (!listingIds.length) {
    throw new ReweApiError("INVALID_INPUT", "At least one listingId is required.");
  }
  const cfg = t.getMarketConfig();
  const marketId = (options.marketId || cfg.marketId).trim();
  const zipCode = (options.zipCode || cfg.zipCode).trim();
  const serviceType = options.serviceType || cfg.serviceType;

  const data = await t.request<any>("/api/products/recommendations", {
    host: "mobile",
    authMode: "none",
    marketId,
    zipCode,
    serviceType,
    includeMarketHeaders: true,
    query: {
      listingIds: listingIds.join(","),
    },
  });

  const recs =
    data?.productRecommendations?.recommendations ||
    data?.recommendations ||
    (Array.isArray(data) ? data : []);
  return Array.isArray(recs) ? recs.map(mapProductSummary) : [];
}

export async function getShopCategories(
  t: ReweTransport,
  options: {
    marketId?: string;
    zipCode?: string;
    serviceType?: ServiceType;
  } = {}
): Promise<ShopCategory[]> {
  const cfg = t.getMarketConfig();
  const marketId = (options.marketId || cfg.marketId).trim();
  const zipCode = (options.zipCode || cfg.zipCode).trim();
  const serviceType = options.serviceType || cfg.serviceType;

  const data = await t.request<any>("/api/shop-overview", {
    host: "mobile",
    authMode: "none",
    marketId,
    zipCode,
    serviceType,
    includeMarketHeaders: true,
  });
  return mapShopCategories(data);
}

export async function getProductRecalls(
  t: ReweTransport
): Promise<ProductRecall[]> {
  const data = await t.request<any>("/api/products/recalls", {
    host: "mobile",
    authMode: "none",
  });
  return mapProductRecalls(data);
}
