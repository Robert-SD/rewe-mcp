import { ReweApiError } from "../errors.js";
import { mapBasket, mapFavoriteList, mapTimeslot } from "../mappers.js";
import { FavoriteList, ReweBasket, ServiceType, Timeslot } from "../types.js";
import { ReweTransport } from "./transport.js";

export async function getFavorites(
  t: ReweTransport,
  options: { includeProducts?: boolean } = {}
): Promise<FavoriteList[]> {
  const cfg = t.getMarketConfig();
  const data = await t.request<any>("/api/favorites", {
    host: "mobile",
    authMode: "required",
    marketId: cfg.marketId,
    zipCode: cfg.zipCode,
    serviceType: cfg.serviceType,
    includeMarketHeaders: true,
    query: {
      includeProducts: options.includeProducts !== false ? "true" : "false",
    },
  });

  const list: any[] =
    data?.favoriteLists?.favorites ||
    data?.favorites ||
    (Array.isArray(data) ? data : []);
  return Array.isArray(list) ? list.map(mapFavoriteList) : [];
}

export async function addFavorite(
  t: ReweTransport,
  listId: string,
  listingId: string,
  options: { productId?: string; quantity?: number } = {}
): Promise<FavoriteList> {
  const lid = listId.trim();
  const itemListingId = listingId.trim();
  if (!lid || !itemListingId) {
    throw new ReweApiError(
      "INVALID_INPUT",
      "Both listId and listingId are required to add a favorite."
    );
  }
  const cfg = t.getMarketConfig();
  const data = await t.request<any>(
    `/api/favorites/${encodeURIComponent(lid)}/lineitems`,
    {
      host: "mobile",
      method: "POST",
      authMode: "required",
      marketId: cfg.marketId,
      zipCode: cfg.zipCode,
      serviceType: cfg.serviceType,
      includeMarketHeaders: true,
      body: {
        listingId: itemListingId,
        ...(options.productId ? { productId: options.productId } : {}),
        ...(options.quantity !== undefined ? { quantity: options.quantity } : {}),
      },
    }
  );
  t.invalidateCache("GET /api/favorites");
  return mapFavoriteList(data?.addLineItemToFavoriteList || data);
}

export async function removeFavorite(
  t: ReweTransport,
  listId: string,
  itemId: string
): Promise<{ removed: boolean; listId: string; itemId: string }> {
  const lid = listId.trim();
  const iid = itemId.trim();
  if (!lid || !iid) {
    throw new ReweApiError(
      "INVALID_INPUT",
      "Both listId and itemId are required to remove a favorite."
    );
  }
  const cfg = t.getMarketConfig();
  await t.request<any>(
    `/api/favorites/${encodeURIComponent(lid)}/lineitems/${encodeURIComponent(iid)}`,
    {
      host: "mobile",
      method: "DELETE",
      authMode: "required",
      marketId: cfg.marketId,
      zipCode: cfg.zipCode,
      serviceType: cfg.serviceType,
      includeMarketHeaders: true,
    }
  );
  t.invalidateCache("GET /api/favorites");
  return { removed: true, listId: lid, itemId: iid };
}

export async function createOrGetBasket(
  t: ReweTransport,
  options: {
    basketId?: string;
    marketId?: string;
    zipCode?: string;
    serviceType?: ServiceType;
  } = {}
): Promise<ReweBasket> {
  const cfg = t.getMarketConfig();
  const marketId = (options.marketId || cfg.marketId).trim();
  const zipCode = (options.zipCode || cfg.zipCode).trim();
  const serviceType = options.serviceType || cfg.serviceType;

  const data = await t.request<any>("/api/baskets", {
    host: "mobile",
    method: "POST",
    authMode: "required",
    marketId,
    zipCode,
    serviceType,
    includeMarketHeaders: true,
    headers: options.basketId ? { "x-rd-basket-id": options.basketId } : undefined,
    body: { includeTimeslot: true },
  });

  return mapBasket(data, { marketId, zipCode, serviceType });
}

export async function setBasketItemQuantity(
  t: ReweTransport,
  options: {
    basketId?: string;
    listingId: string;
    quantity: number;
    version?: number;
    marketId?: string;
    zipCode?: string;
    serviceType?: ServiceType;
  }
): Promise<ReweBasket> {
  const listingId = options.listingId.trim();
  if (!listingId) {
    throw new ReweApiError("INVALID_INPUT", "listingId must not be empty.");
  }
  if (!Number.isInteger(options.quantity) || options.quantity < 0) {
    throw new ReweApiError("INVALID_INPUT", "quantity must be a non-negative integer.");
  }

  const cfg = t.getMarketConfig();
  const marketId = (options.marketId || cfg.marketId).trim();
  const zipCode = (options.zipCode || cfg.zipCode).trim();
  const serviceType = options.serviceType || cfg.serviceType;

  let basketId = options.basketId?.trim();
  let version = options.version;
  if (!basketId || version === undefined) {
    const current = await createOrGetBasket(t, {
      basketId,
      marketId,
      zipCode,
      serviceType,
    });
    basketId = current.id;
    version = current.version ?? 0;
  }

  if (options.quantity === 0) {
    const data = await t.request<any>(
      `/api/baskets/${encodeURIComponent(basketId)}/listings/${encodeURIComponent(listingId)}`,
      {
        host: "mobile",
        method: "DELETE",
        authMode: "required",
        marketId,
        zipCode,
        serviceType,
        includeMarketHeaders: true,
        headers: { "x-rd-basket-id": basketId },
      }
    );
    return mapBasket(data, { marketId, zipCode, serviceType });
  }

  const data = await t.request<any>(
    `/api/baskets/${encodeURIComponent(basketId)}/listings/${encodeURIComponent(listingId)}`,
    {
      host: "mobile",
      method: "POST",
      authMode: "required",
      marketId,
      zipCode,
      serviceType,
      includeMarketHeaders: true,
      headers: { "x-rd-basket-id": basketId },
      body: {
        quantity: options.quantity,
        basketVersion: version,
        includeTimeslot: true,
      },
    }
  );

  return mapBasket(data, { marketId, zipCode, serviceType });
}

export async function getTimeslots(
  t: ReweTransport,
  options: {
    basketId?: string;
    marketId?: string;
    zipCode?: string;
    serviceType?: ServiceType;
  } = {}
): Promise<Timeslot[]> {
  const cfg = t.getMarketConfig();
  const marketId = (options.marketId || cfg.marketId).trim();
  const zipCode = (options.zipCode || cfg.zipCode).trim();
  const serviceType = options.serviceType || cfg.serviceType;

  let basketId = options.basketId?.trim();
  if (!basketId) {
    const basket = await createOrGetBasket(t, { marketId, zipCode, serviceType });
    basketId = basket.id;
  }

  const data = await t.request<any>("/api/timeslots/checkout", {
    host: "mobile",
    authMode: "required",
    marketId,
    zipCode,
    serviceType,
    includeMarketHeaders: true,
    headers: basketId ? { "x-rd-basket-id": basketId } : undefined,
  });

  const list: any[] =
    data?.getTimeslotsCheckout ||
    data?.timeslots ||
    (Array.isArray(data) ? data : []);
  return Array.isArray(list) ? list.map(mapTimeslot) : [];
}
