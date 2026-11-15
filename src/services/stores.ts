import { getOptionalAccessToken } from "../auth.js";
import { ReweApiError } from "../errors.js";
import {
  mapMarketDetails,
  mapMarketList,
  mapServicePortfolio,
} from "../mappers.js";
import {
  MarketConfig,
  MarketDetails,
  MarketInfo,
  ServicePortfolio,
  ServiceType,
} from "../types.js";
import { ReweTransport } from "./transport.js";

export async function searchMarkets(
  t: ReweTransport,
  query: string
): Promise<MarketInfo[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new ReweApiError("INVALID_INPUT", "Search query must not be empty.");
  }
  const data = await t.request<any>("/api/stationary-markets", {
    host: "mobile",
    authMode: "none",
    query: { search: trimmed },
  });
  return mapMarketList(data);
}

export async function getMarketDetails(
  t: ReweTransport,
  marketId?: string
): Promise<MarketDetails> {
  const resolvedId = (marketId || t.getMarketConfig().marketId).trim();
  if (!resolvedId) {
    throw new ReweApiError("INVALID_INPUT", "marketId must not be empty.");
  }
  const data = await t.request<any>(
    `/api/stationary-markets/${encodeURIComponent(resolvedId)}`,
    {
      host: "mobile",
      authMode: "none",
    }
  );
  return mapMarketDetails(data);
}

export async function getServicePortfolio(
  t: ReweTransport,
  zipCode?: string
): Promise<ServicePortfolio> {
  const resolvedZip = (zipCode || t.getMarketConfig().zipCode).trim();
  if (!resolvedZip) {
    throw new ReweApiError("INVALID_INPUT", "zipCode must not be empty.");
  }
  const data = await t.request<any>(
    `/api/service-portfolio/${encodeURIComponent(resolvedZip)}`,
    {
      host: "mobile",
      authMode: "none",
    }
  );
  return mapServicePortfolio(data, resolvedZip);
}

export async function getBulkyGoodsConfig(
  t: ReweTransport,
  options: { marketId?: string; serviceType?: ServiceType } = {}
): Promise<unknown> {
  const cfg = t.getMarketConfig();
  const marketId = (options.marketId || cfg.marketId).trim();
  const serviceType = options.serviceType || cfg.serviceType;
  return t.request<any>(
    `/api/bulky-goods-configuration/${encodeURIComponent(marketId)}/service-types/${encodeURIComponent(serviceType)}`,
    {
      host: "mobile",
      authMode: "none",
      marketId,
      serviceType,
      includeMarketHeaders: true,
    }
  );
}

export function getSelectedMarket(t: ReweTransport): MarketConfig {
  return t.getMarketConfig();
}

export async function setSelectedMarket(
  t: ReweTransport,
  input: {
    marketId: string;
    zipCode?: string;
    serviceType?: ServiceType;
    marketName?: string;
    city?: string;
  }
): Promise<MarketConfig> {
  const marketId = input.marketId.trim();
  if (!marketId) {
    throw new ReweApiError("INVALID_INPUT", "marketId must not be empty.");
  }

  let marketName = input.marketName;
  let city = input.city;
  let zipCode = input.zipCode?.trim();

  if (!marketName || !city || !zipCode) {
    try {
      const details = await getMarketDetails(t, marketId);
      marketName = marketName || details.name;
      city = city || details.city;
      zipCode = zipCode || details.zipCode;
    } catch {
      // Proceed even if market metadata lookup fails or mTLS is mocked
    }
  }

  const updated = t.setMarketConfig({
    marketId,
    ...(zipCode ? { zipCode } : {}),
    ...(input.serviceType ? { serviceType: input.serviceType } : {}),
    ...(marketName ? { marketName } : {}),
    ...(city ? { city } : {}),
  });

  // Invalidate market-dependent caches
  t.invalidateCache("GET /api/stationary-offers");
  t.invalidateCache("GET /api/products");
  t.invalidateCache("GET /api/shop-overview");

  // Best-effort sync to authenticated REWE account market selection
  try {
    const token = await getOptionalAccessToken();
    if (token) {
      await t.request("/api/customer-market-selections", {
        host: "mobile",
        method: "PUT",
        authMode: "optional",
        marketId: updated.marketId,
        zipCode: updated.zipCode,
        serviceType: updated.serviceType,
        includeMarketHeaders: true,
        body: {
          wwIdent: updated.marketId,
          zipCode: updated.zipCode,
          serviceType: updated.serviceType,
        },
      });
    }
  } catch {
    // Ignore optional upstream sync errors; local config is authoritative
  }

  return updated;
}
