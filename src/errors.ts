import { ReweAuthError } from "./token-store.js";

export type ReweErrorCode =
  | "AUTH_REQUIRED"
  | "MTLS_REQUIRED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "RATE_LIMITED";

export interface StructuredToolError {
  code: ReweErrorCode;
  message: string;
  status?: number;
  endpoint?: string;
  retryable: boolean;
  details?: unknown;
}

export function httpStatusToErrorCode(status: number): ReweErrorCode {
  if (status === 404) return "NOT_FOUND";
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "AUTH_REQUIRED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 400 || status === 422) return "INVALID_INPUT";
  return "UPSTREAM_ERROR";
}

export function extractBodyMessage(rawBody: string): string | undefined {
  const trimmed = rawBody.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    const first = Array.isArray(parsed)
      ? parsed[0]
      : Array.isArray(parsed?.errors)
        ? parsed.errors[0]
        : parsed;
    const candidate =
      first?.detail ||
      first?.title ||
      first?.message ||
      first?.error_description ||
      first?.error;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  } catch {
    // Plain text / HTML fallback below
  }
  if (/<!doctype html|<html/i.test(trimmed)) {
    return "Upstream returned an HTML page (Cloudflare challenge or mTLS/WAF block)";
  }
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
}

/**
 * Structured error raised when a REWE API call fails, lacks mTLS certificates, or fails validation.
 */
export class ReweApiError extends Error {
  readonly code: ReweErrorCode;
  readonly status?: number;
  readonly endpoint?: string;
  readonly details?: unknown;

  constructor(
    code: ReweErrorCode,
    message: string,
    status?: number,
    endpoint?: string,
    details?: unknown
  ) {
    super(message);
    this.name = "ReweApiError";
    this.code = code;
    this.status = status;
    this.endpoint = endpoint;
    this.details = details;
  }

  static fromHttpStatus(
    status: number,
    rawBody = "",
    endpoint?: string,
    fallbackMessage?: string
  ): ReweApiError {
    const extracted = extractBodyMessage(rawBody);
    let code = httpStatusToErrorCode(status);
    let message =
      extracted || fallbackMessage || `REWE API request failed with HTTP ${status}`;

    if (
      status === 403 &&
      /<!doctype html|<html|cloudflare|client ssl|certificate|mtls/i.test(rawBody)
    ) {
      code = "MTLS_REQUIRED";
      message =
        "Cloudflare rejected the request (HTTP 403). Ensure a valid REWE mTLS client certificate is configured (in ~/.config/rewe-mcp/certs/ or via REWE_MTLS_CERT / REWE_MTLS_KEY) or check WAF limits.";
    }

    return new ReweApiError(code, message, status, endpoint);
  }
}

const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function isRetryable(code: ReweErrorCode): boolean {
  return code === "RATE_LIMITED" || code === "UPSTREAM_ERROR";
}

/**
 * Convert any thrown error into a consistent machine-readable payload
 * for MCP tool error responses.
 */
export function normalizeToolError(error: unknown): StructuredToolError {
  if (error instanceof ReweApiError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.endpoint ? { endpoint: error.endpoint } : {}),
      retryable: isRetryable(error.code),
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
  }

  if (error instanceof ReweAuthError) {
    return {
      code: "AUTH_REQUIRED",
      message: error.message,
      retryable: false,
    };
  }

  const errObj = error as any;
  const status = typeof errObj?.status === "number" ? errObj.status : undefined;
  if (status !== undefined) {
    const code = httpStatusToErrorCode(status);
    return {
      code,
      message:
        typeof errObj?.message === "string" && errObj.message
          ? errObj.message
          : `Request failed with HTTP ${status}`,
      status,
      retryable: isRetryable(code),
    };
  }

  const sysCode = typeof errObj?.code === "string" ? errObj.code : "";
  const causeCode = typeof errObj?.cause?.code === "string" ? errObj.cause.code : "";
  const msg =
    typeof errObj?.message === "string" && errObj.message
      ? errObj.message
      : String(error || "Unknown error");

  if (/\b(mtls|certificate|private\.key|certificate\.pem|pkcs12)\b/i.test(msg)) {
    return {
      code: "MTLS_REQUIRED",
      message: msg,
      retryable: false,
    };
  }

  if (
    NETWORK_ERROR_CODES.has(sysCode) ||
    NETWORK_ERROR_CODES.has(causeCode) ||
    error instanceof TypeError ||
    /\b(fetch failed|network|timed out|ECONN|ENOTFOUND)\b/i.test(msg)
  ) {
    return {
      code: "UPSTREAM_ERROR",
      message: msg,
      retryable: true,
    };
  }

  if (/\b(not authenticated|not logged in|no tokens?|login required)\b/i.test(msg)) {
    return {
      code: "AUTH_REQUIRED",
      message: msg,
      retryable: false,
    };
  }

  return {
    code: "UPSTREAM_ERROR",
    message: msg,
    retryable: false,
  };
}
