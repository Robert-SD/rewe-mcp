import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ReweApiError } from "../errors.js";
import {
  mapEbonSummary,
  mapOrderDetail,
  mapOrderSummary,
  mapProductSummary,
} from "../mappers.js";
import {
  EbonSummary,
  ReweOrderDetail,
  ReweOrderSummary,
  ReweProduct,
} from "../types.js";
import { ReweTransport } from "./transport.js";

export async function listEbons(
  t: ReweTransport,
  limit?: number
): Promise<{
  ebonActive?: boolean;
  totalCount: number;
  receipts: EbonSummary[];
}> {
  const [ebonsRes, statusRes] = await Promise.allSettled([
    t.request<any>("/api/ebons", {
      host: "mobile",
      authMode: "required",
    }),
    t.request<any>("/api/ebon-status", {
      host: "mobile",
      authMode: "required",
    }),
  ]);

  if (ebonsRes.status === "rejected") {
    throw ebonsRes.reason;
  }

  const raw = ebonsRes.value;
  const list: any[] =
    raw?.getEbons?.items ||
    raw?.eBons?.receiptList ||
    raw?.receiptList ||
    raw?.items ||
    (Array.isArray(raw) ? raw : []);

  const mapped = Array.isArray(list) ? list.map(mapEbonSummary) : [];
  const receipts = limit && limit > 0 ? mapped.slice(0, limit) : mapped;

  const statusData = statusRes.status === "fulfilled" ? statusRes.value : undefined;
  const ebonActive =
    statusData?.ebonStatus?.active ??
    statusData?.active ??
    undefined;

  return {
    ...(ebonActive !== undefined ? { ebonActive: Boolean(ebonActive) } : {}),
    totalCount: mapped.length,
    receipts,
  };
}

export async function getEbonPdf(
  t: ReweTransport,
  ebonId: string,
  savePath?: string
): Promise<{
  id: string;
  sizeBytes: number;
  savedTo?: string;
  base64Pdf?: string;
}> {
  const id = ebonId.trim();
  if (!id) {
    throw new ReweApiError("INVALID_INPUT", "ebonId must not be empty.");
  }

  const pdfBuf = await t.requestBinary(
    `/api/receipts/${encodeURIComponent(id)}/pdf`,
    {
      host: "mobile",
      authMode: "required",
      headers: {
        Accept: "application/pdf, application/octet-stream, */*",
      },
    }
  );

  if (savePath && savePath.trim()) {
    const resolved = path.resolve(savePath.trim().replace(/^~/, os.homedir()));
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, pdfBuf);
    return {
      id,
      sizeBytes: pdfBuf.byteLength,
      savedTo: resolved,
    };
  }

  return {
    id,
    sizeBytes: pdfBuf.byteLength,
    base64Pdf: pdfBuf.toString("base64"),
  };
}

export async function listOrders(
  t: ReweTransport,
  limit?: number
): Promise<ReweOrderSummary[]> {
  const data = await t.request<any>("/api/orders/history", {
    host: "mobile",
    authMode: "required",
  });

  const list: any[] =
    data?.orderHistory?.orders ||
    data?.orders ||
    (Array.isArray(data) ? data : []);
  const mapped = Array.isArray(list) ? list.map(mapOrderSummary) : [];
  return limit && limit > 0 ? mapped.slice(0, limit) : mapped;
}

export async function getOrderDetails(
  t: ReweTransport,
  orderId: string
): Promise<ReweOrderDetail> {
  const id = orderId.trim();
  if (!id) {
    throw new ReweApiError("INVALID_INPUT", "orderId must not be empty.");
  }
  const data = await t.request<any>(`/api/orders/${encodeURIComponent(id)}`, {
    host: "mobile",
    authMode: "required",
  });
  return mapOrderDetail(data);
}

export async function getPurchasedProducts(
  t: ReweTransport,
  options: {
    page?: number;
    objectsPerPage?: number;
    filter?: string;
  } = {}
): Promise<ReweProduct[]> {
  const cfg = t.getMarketConfig();
  const data = await t.request<any>("/api/purchased-products", {
    host: "mobile",
    authMode: "required",
    marketId: cfg.marketId,
    zipCode: cfg.zipCode,
    serviceType: cfg.serviceType,
    includeMarketHeaders: true,
    query: {
      page: options.page ?? 1,
      objectsPerPage: options.objectsPerPage ?? 50,
      ...(options.filter ? { filter: options.filter } : {}),
    },
  });

  const list: any[] =
    data?.purchasedProducts?.products ||
    data?.products ||
    (Array.isArray(data) ? data : []);
  return Array.isArray(list) ? list.map(mapProductSummary) : [];
}
