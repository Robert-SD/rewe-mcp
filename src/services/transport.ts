import { MarketConfig, ServiceType } from "../types.js";

export type HostKey = "mobile" | "account" | "msco";
export type AuthMode = "required" | "optional" | "none";

export interface RequestOptions {
  host?: HostKey;
  method?: string;
  body?: any;
  query?: Record<string, any>;
  headers?: Record<string, string>;
  authMode?: AuthMode;
  marketId?: string;
  zipCode?: string;
  serviceType?: ServiceType;
  includeMarketHeaders?: boolean;
  unwrapData?: boolean;
}

export interface ReweTransport {
  request<T = any>(path: string, options?: RequestOptions): Promise<T>;
  requestBinary(path: string, options?: RequestOptions): Promise<Buffer>;
  getMarketConfig(): MarketConfig;
  setMarketConfig(update: Partial<MarketConfig>): MarketConfig;
  invalidateCache(prefix: string): void;
}
