import { ReweApiError } from "../errors.js";
import { mapBonusSummary, mapCoupon, mapMemberProfile } from "../mappers.js";
import { BonusSummary, MemberProfile, ReweCoupon } from "../types.js";
import { ReweTransport } from "./transport.js";

export async function getProfile(t: ReweTransport): Promise<MemberProfile> {
  const [userinfoRes, customerRes, reweIdRes] = await Promise.allSettled([
    t.request<any>("/realms/sso/protocol/openid-connect/userinfo", {
      host: "account",
      authMode: "required",
      unwrapData: false,
    }),
    t.request<any>("/api/customers", {
      host: "mobile",
      authMode: "required",
    }),
    t.request<any>("/api/rewe-id", {
      host: "mobile",
      authMode: "required",
    }),
  ]);

  if (
    userinfoRes.status === "rejected" &&
    customerRes.status === "rejected" &&
    reweIdRes.status === "rejected"
  ) {
    throw userinfoRes.reason;
  }

  return mapMemberProfile(
    userinfoRes.status === "fulfilled" ? userinfoRes.value : {},
    customerRes.status === "fulfilled" ? customerRes.value : {},
    reweIdRes.status === "fulfilled" ? reweIdRes.value : {},
    t.getMarketConfig()
  );
}

export async function getBonusSummary(t: ReweTransport): Promise<BonusSummary> {
  const [balanceRes, accountRes, loyaltyRes, missionsRes] = await Promise.allSettled([
    t.request<any>("/api/bonus/balance", {
      host: "mobile",
      authMode: "required",
    }),
    t.request<any>("/api/bonus/account", {
      host: "mobile",
      authMode: "required",
    }),
    t.request<any>("/api/loyalty-points/overview", {
      host: "mobile",
      authMode: "required",
    }),
    t.request<any>("/api/bonus/missions/articles", {
      host: "mobile",
      authMode: "required",
    }),
  ]);

  if (
    balanceRes.status === "rejected" &&
    accountRes.status === "rejected" &&
    loyaltyRes.status === "rejected"
  ) {
    throw balanceRes.reason;
  }

  return mapBonusSummary(
    balanceRes.status === "fulfilled" ? balanceRes.value : {},
    accountRes.status === "fulfilled" ? accountRes.value : {},
    loyaltyRes.status === "fulfilled" ? loyaltyRes.value : {},
    missionsRes.status === "fulfilled" ? missionsRes.value : undefined
  );
}

export async function getBonusCoupons(t: ReweTransport): Promise<ReweCoupon[]> {
  let raw: any;
  try {
    raw = await t.request<any>("/api/bonus/coupons", {
      host: "mobile",
      authMode: "required",
    });
  } catch (err: any) {
    if (err instanceof ReweApiError && err.code === "NOT_FOUND") {
      raw = await t.request<any>("/api/coupons", {
        host: "mobile",
        authMode: "required",
      });
    } else {
      throw err;
    }
  }

  const list: any[] = Array.isArray(raw?.coupons)
    ? raw.coupons
    : Array.isArray(raw?.bonusCoupons)
      ? raw.bonusCoupons
      : Array.isArray(raw)
        ? raw
        : [];
  return list.map(mapCoupon);
}

export async function getBonusTransactions(
  t: ReweTransport,
  limit?: number
): Promise<unknown> {
  const data = await t.request<any>("/api/bonus/transactions", {
    host: "mobile",
    authMode: "required",
  });
  if (limit && limit > 0 && Array.isArray(data?.transactions)) {
    return {
      ...data,
      transactions: data.transactions.slice(0, limit),
    };
  }
  return data;
}
