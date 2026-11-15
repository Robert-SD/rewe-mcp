import * as crypto from "node:crypto";
import { exec, execFile } from "node:child_process";
import * as fs from "node:fs";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { getMtlsStatus, loadMtlsCredentials } from "./certs.js";
import { AuthSessionStatus, TokensData } from "./types.js";
import {
  ReweAuthError,
  assertTokensPathWritable,
  getDefaultConfigDir,
  getTokenStore,
  getTokensFilePath,
  loadMarketConfig,
  loadTokens,
  resolveRefreshToken,
  saveTokens,
  TokenStore,
} from "./token-store.js";

export * from "./token-store.js";

export const SSO_BASE_URL = (
  process.env.REWE_SSO_BASE || "https://account.rewe.de/realms/sso"
).replace(/\/+$/, "");

export const CLIENT_ID = process.env.REWE_CLIENT_ID || "reweios";
export const REDIRECT_URI = process.env.REWE_REDIRECT_URI || "de.rewe.app://redirect";
export const SCOPE =
  process.env.REWE_OAUTH_SCOPE || "openid email customer offline_access profile";
export const AUTH_URL = `${SSO_BASE_URL}/protocol/openid-connect/auth`;
export const TOKEN_URL = `${SSO_BASE_URL}/protocol/openid-connect/token`;
export const USERINFO_URL = `${SSO_BASE_URL}/protocol/openid-connect/userinfo`;

export const MOBILE_USER_AGENT =
  process.env.REWE_USER_AGENT ||
  "REWE-Mobile-Client/5.19.0.55137 Android/14 Phone/Google_Pixel_8_Pro";

export const HOST_CONFIG = {
  mobile: (process.env.REWE_MOBILE_API_BASE || "https://mobile-clients-api.rewe.de").replace(
    /\/+$/,
    ""
  ),
  account: (process.env.REWE_ACCOUNT_BASE || "https://account.rewe.de").replace(/\/+$/, ""),
  msco: (process.env.REWE_MSCO_BASE || "https://msco.rewe.de").replace(/\/+$/, ""),
} as const;

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(codeVerifier: string): string {
  return crypto.createHash("sha256").update(codeVerifier).digest("base64url");
}

export function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
}

export function buildAuthUrl(options?: {
  codeChallenge?: string;
  state?: string;
}): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: REDIRECT_URI,
  });
  if (options?.codeChallenge) {
    params.set("code_challenge", options.codeChallenge);
    params.set("code_challenge_method", "S256");
  }
  if (options?.state) {
    params.set("state", options.state);
  }
  return `${AUTH_URL}?${params.toString()}`;
}

export function parseRedirectCode(codeOrUrl: string): string {
  const trimmed = codeOrUrl.trim().replace(/^['"]+|['"]+$/g, "");
  const embeddedRedirect = trimmed.match(/de\.rewe\.app:\/\/[^\s'"<>]+/i);
  const candidate = embeddedRedirect ? embeddedRedirect[0] : trimmed;

  if (candidate.includes("://") || candidate.includes("?")) {
    try {
      const normalized = candidate.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "https://dummy/");
      const parsed = new URL(normalized);
      const code = parsed.searchParams.get("code");
      if (code) return code;
    } catch {
      // Fallback to regex / raw input below
    }
  }

  const codeMatch = candidate.match(/(?:[?&]|^)code=([^&#\s'"]+)/);
  if (codeMatch?.[1]) {
    try {
      return decodeURIComponent(codeMatch[1]);
    } catch {
      return codeMatch[1];
    }
  }

  return trimmed;
}

export function isAuthorizationRedirectUrl(targetUrl: string): boolean {
  try {
    const expected = new URL(REDIRECT_URI);
    const actual = new URL(targetUrl);
    return (
      actual.protocol === expected.protocol &&
      actual.host === expected.host &&
      actual.pathname === expected.pathname &&
      actual.searchParams.has("code")
    );
  } catch {
    return false;
  }
}

export interface AuthFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  useMtls?: boolean;
  signal?: AbortSignal;
}

export interface AuthFetchResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<any>;
  buffer: () => Promise<Buffer>;
}

function httpsRequestOnce(
  urlStr: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  mtls: { cert: string; key: string } | null,
  signal?: AbortSignal
): Promise<AuthFetchResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const bodyBuf = body ? Buffer.from(body, "utf-8") : undefined;
    const reqHeaders: Record<string, string> = {
      ...headers,
      ...(bodyBuf ? { "Content-Length": String(bodyBuf.byteLength) } : {}),
    };

    const agent = new https.Agent({
      keepAlive: false,
      ...(mtls ? { cert: mtls.cert, key: mtls.key } : {}),
    });

    const req = https.request(
      parsed,
      {
        method,
        headers: reqHeaders,
        agent,
        signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        const onAbort = () => {
          res.destroy(signal?.reason || new Error("The operation was aborted"));
        };
        if (signal) {
          if (signal.aborted) {
            return reject(signal.reason || new Error("The operation was aborted"));
          }
          signal.addEventListener("abort", onAbort, { once: true });
        }

        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("error", (e) => {
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(e);
        });
        res.on("end", () => {
          if (signal) signal.removeEventListener("abort", onAbort);
          const buf = Buffer.concat(chunks);
          const status = res.statusCode || 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            buffer: async () => buf,
            text: async () => buf.toString("utf-8"),
            json: async () => JSON.parse(buf.toString("utf-8")),
          });
        });
      }
    );

    req.on("error", (e) => reject(e));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function curlRequestOnce(
  urlStr: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  mtlsPaths: { certPath?: string; keyPath?: string; cert: string; key: string } | null,
  signal?: AbortSignal
): Promise<AuthFetchResponse> {
  return new Promise((resolve, reject) => {
    const delimiter = Buffer.from("\n---HTTP_STATUS---");
    const args: string[] = [
      "-s",
      "-S",
      "-X",
      method,
      "-w",
      `\n---HTTP_STATUS---%{http_code}`,
      urlStr,
    ];

    if (mtlsPaths) {
      let certFile = mtlsPaths.certPath;
      let keyFile = mtlsPaths.keyPath;
      if (!certFile || !keyFile) {
        const fallbackDir = path.join(os.tmpdir(), "rewe-mcp-mtls");
        fs.mkdirSync(fallbackDir, { recursive: true, mode: 0o700 });
        certFile = path.join(fallbackDir, "cert.pem");
        keyFile = path.join(fallbackDir, "key.pem");
        fs.writeFileSync(certFile, mtlsPaths.cert, { mode: 0o600 });
        fs.writeFileSync(keyFile, mtlsPaths.key, { mode: 0o600 });
      }
      args.push("--cert", certFile, "--key", keyFile);
    }

    for (const [k, v] of Object.entries(headers)) {
      args.push("-H", `${k}: ${v}`);
    }
    if (body !== undefined) {
      args.push("--data-raw", body);
    }

    execFile(
      "curl",
      args,
      { encoding: "buffer", maxBuffer: 20 * 1024 * 1024, signal },
      (err, stdout, stderr) => {
        if (err) {
          return reject(
            new Error(`curl failed: ${err.message} (${stderr?.toString?.("utf-8") || ""})`)
          );
        }
        const outBuf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || "");
        const idx = outBuf.lastIndexOf(delimiter);
        const bodyBuf = idx >= 0 ? outBuf.subarray(0, idx) : outBuf;
        const statusStr =
          idx >= 0 ? outBuf.subarray(idx + delimiter.length).toString("utf-8").trim() : "0";
        const statusCode = parseInt(statusStr, 10) || 0;
        resolve({
          ok: statusCode >= 200 && statusCode < 300,
          status: statusCode,
          buffer: async () => bodyBuf,
          text: async () => bodyBuf.toString("utf-8"),
          json: async () => JSON.parse(bodyBuf.toString("utf-8")),
        });
      }
    );
  });
}

/**
 * HTTP request wrapper with optional Cloudflare mTLS client certificate support (`node:https` + `curl` fallback).
 */
export async function authFetch(
  urlStr: string,
  options: AuthFetchOptions = {}
): Promise<AuthFetchResponse> {
  if (options.signal?.aborted) {
    throw options.signal.reason || new Error("The operation was aborted");
  }

  const method = (options.method || "GET").toUpperCase();
  const mergedHeaders: Record<string, string> = {
    "User-Agent": MOBILE_USER_AGENT,
    "Accept-Language": "de-DE,de;q=0.9",
    ...(options.headers || {}),
  };

  const mtls = options.useMtls ? loadMtlsCredentials() : null;
  let lastErr: any = null;

  // For standard non-mTLS endpoints (e.g. account.rewe.de), try global fetch first
  if (!mtls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(urlStr, {
          method,
          headers: mergedHeaders,
          body: options.body,
          signal: options.signal,
        });
        const ab = await res.arrayBuffer();
        const buf = Buffer.from(ab);
        return {
          ok: res.ok,
          status: res.status,
          buffer: async () => buf,
          text: async () => buf.toString("utf-8"),
          json: async () => JSON.parse(buf.toString("utf-8")),
        };
      } catch (err: any) {
        lastErr = err;
        if (options.signal?.aborted) {
          throw options.signal.reason || err;
        }
        const isEbadf =
          err?.message?.includes("EBADF") ||
          err?.cause?.code === "EBADF" ||
          err?.cause?.message?.includes("EBADF");
        if (isEbadf) break;
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
    }
  }

  // Try node:https (natively supports client cert & key for mTLS)
  try {
    const res = await httpsRequestOnce(
      urlStr,
      method,
      mergedHeaders,
      options.body,
      mtls ? { cert: mtls.cert, key: mtls.key } : null,
      options.signal
    );
    // If Cloudflare challenges Node TLS fingerprint with an HTML 403, try curl fallback
    if (res.status === 403) {
      const preview = await res.text();
      if (/<!doctype html|<html|cloudflare/i.test(preview)) {
        try {
          return await curlRequestOnce(urlStr, method, mergedHeaders, options.body, mtls, options.signal);
        } catch {
          return res;
        }
      }
    }
    return res;
  } catch (httpsErr: any) {
    lastErr = httpsErr;
    if (options.signal?.aborted) {
      throw options.signal.reason || httpsErr;
    }
  }

  // Final fallback: system curl
  try {
    return await curlRequestOnce(urlStr, method, mergedHeaders, options.body, mtls, options.signal);
  } catch (curlErr: any) {
    throw lastErr || curlErr;
  }
}

function extractCustomerIdFromJwt(jwt?: string): string | undefined {
  if (!jwt) return undefined;
  const parts = jwt.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return (
      (typeof payload?.customer_id === "string" && payload.customer_id) ||
      (typeof payload?.sub === "string" && payload.sub) ||
      undefined
    );
  } catch {
    return undefined;
  }
}

function enrichTokens(raw: any, fallbackRefreshToken?: string): TokensData {
  const expiresIn =
    typeof raw.expires_in === "number" && Number.isFinite(raw.expires_in)
      ? raw.expires_in
      : 300;
  const now = Date.now();
  const refreshToken = raw.refresh_token || fallbackRefreshToken;
  return {
    access_token: raw.access_token,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    ...(raw.id_token ? { id_token: raw.id_token } : {}),
    ...(raw.token_type ? { token_type: raw.token_type } : {}),
    expires_in: expiresIn,
    expires_at: new Date(now + expiresIn * 1000).toISOString(),
    saved_at: new Date(now).toISOString(),
    ...(raw.scope ? { scope: raw.scope } : {}),
    ...(extractCustomerIdFromJwt(raw.access_token) || extractCustomerIdFromJwt(raw.id_token)
      ? {
          customer_id:
            extractCustomerIdFromJwt(raw.access_token) || extractCustomerIdFromJwt(raw.id_token),
        }
      : {}),
  };
}

export async function exchangeCode(
  codeOrUrl: string,
  codeVerifier?: string,
  opts: { save?: boolean; tokenStore?: TokenStore } = {}
): Promise<TokensData> {
  const code = parseRedirectCode(codeOrUrl);
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code,
  });
  if (codeVerifier) {
    form.set("code_verifier", codeVerifier);
  }

  const resp = await authFetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
    useMtls: false,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new ReweAuthError(
      "TOKEN_EXCHANGE_FAILED",
      `REWE token exchange failed (${resp.status}): ${errText}`
    );
  }

  const raw = await resp.json();
  const tokens = enrichTokens(raw);

  if (opts.save !== false) {
    await saveTokens(tokens, opts.tokenStore);
  }

  return tokens;
}

let inflightRefresh: Promise<TokensData> | null = null;

export async function refreshTokens(
  refreshTokenOverride?: string,
  tokenStore?: TokenStore
): Promise<TokensData> {
  const store = tokenStore || getTokenStore();
  const initialTokens = await loadTokens(store);
  const initialRefreshToken = initialTokens?.refresh_token;
  const initialSavedAt = initialTokens?.saved_at;

  const doRefresh = async (ctx?: { waited?: boolean }): Promise<TokensData> => {
    const tokens = (await loadTokens(store)) || initialTokens || null;
    if (ctx?.waited) {
      const tokenChanged = Boolean(
        tokens &&
          ((initialRefreshToken && tokens.refresh_token !== initialRefreshToken) ||
            (initialSavedAt && tokens.saved_at !== initialSavedAt))
      );
      if (tokenChanged && tokens?.access_token) {
        return tokens;
      }
    }

    const rToken = refreshTokenOverride || resolveRefreshToken(tokens).token;
    if (!rToken) {
      throw new ReweAuthError(
        "MISSING_REFRESH_TOKEN",
        `No REWE refresh_token available (checked ${getTokensFilePath()} and REWE_REFRESH_TOKEN). Run 'npm run login' to authenticate.`
      );
    }

    await assertTokensPathWritable(store);

    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: rToken,
    });

    const resp = await authFetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
      useMtls: false,
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new ReweAuthError(
        "TOKEN_REFRESH_FAILED",
        `REWE token refresh failed (${resp.status}): ${errText}`
      );
    }

    const raw = await resp.json();
    const refreshed = enrichTokens(raw, rToken);
    await saveTokens(refreshed, store);
    return refreshed;
  };

  if (store.withLock) {
    return await store.withLock(doRefresh);
  }

  if (!inflightRefresh) {
    inflightRefresh = doRefresh().finally(() => {
      inflightRefresh = null;
    });
  }
  return await inflightRefresh;
}

function getExpiresAtMs(tokens: TokensData | null): number | null {
  if (!tokens) return null;
  if (tokens.expires_at) {
    const ms = new Date(tokens.expires_at).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  if (tokens.saved_at) {
    const saved = new Date(tokens.saved_at).getTime();
    if (!Number.isNaN(saved)) {
      return saved + (tokens.expires_in ?? 300) * 1000;
    }
  }
  return null;
}

export async function getValidAccessToken(tokenStore?: TokenStore): Promise<string> {
  const store = tokenStore || getTokenStore();
  const tokens = await loadTokens(store);
  const envAccessToken = process.env.REWE_ACCESS_TOKEN?.trim();
  const { token: refreshToken } = resolveRefreshToken(tokens);

  let accessToken = tokens?.access_token || envAccessToken;
  if (!accessToken && !refreshToken) {
    throw new ReweAuthError(
      "UNAUTHENTICATED",
      `No REWE session found (${getTokensFilePath()}). Run 'npm run login' to authenticate.`
    );
  }

  let shouldRefresh = !accessToken;
  if (accessToken && tokens?.access_token) {
    const expMs = getExpiresAtMs(tokens);
    if (expMs !== null && Date.now() >= expMs - 30_000) {
      shouldRefresh = true;
    }
  }

  if (shouldRefresh && refreshToken) {
    try {
      const fresh = await refreshTokens(refreshToken, store);
      accessToken = fresh.access_token;
    } catch (err) {
      if (!accessToken) throw err;
    }
  }

  if (!accessToken) {
    throw new ReweAuthError(
      "UNAUTHENTICATED",
      "No valid REWE access token available. Run 'npm run login' to authenticate."
    );
  }

  return accessToken;
}

export async function forceRefreshAccessToken(tokenStore?: TokenStore): Promise<string> {
  const store = tokenStore || getTokenStore();
  const fresh = await refreshTokens(undefined, store);
  return fresh.access_token;
}

export async function getOptionalAccessToken(tokenStore?: TokenStore): Promise<string | null> {
  try {
    return await getValidAccessToken(tokenStore);
  } catch (err) {
    if (
      err instanceof ReweAuthError &&
      (err.code === "UNAUTHENTICATED" || err.code === "MISSING_REFRESH_TOKEN")
    ) {
      return null;
    }
    throw err;
  }
}

export async function getAuthStatus(tokenStore?: TokenStore): Promise<AuthSessionStatus> {
  const store = tokenStore || getTokenStore();
  const tokens = await loadTokens(store);
  const envAccess = process.env.REWE_ACCESS_TOKEN?.trim();
  const { token: refreshToken, source: refreshSource } = resolveRefreshToken(tokens);
  const mtls = getMtlsStatus();
  const marketConfig = loadMarketConfig();

  const hasFileToken = Boolean(tokens?.access_token);
  const hasAccessToken = Boolean(tokens?.access_token || envAccess);
  const hasRefreshToken = Boolean(refreshToken);

  let tokenSource: AuthSessionStatus["tokenSource"] = "none";
  if (hasFileToken) tokenSource = "file";
  else if (envAccess || refreshSource === "env") tokenSource = "env";

  const expMs = getExpiresAtMs(tokens);
  const expiresAt = expMs !== null ? new Date(expMs).toISOString() : undefined;
  const expiresInSeconds =
    expMs !== null ? Math.floor((expMs - Date.now()) / 1000) : undefined;

  const authenticated = hasAccessToken || hasRefreshToken;
  const customerId =
    tokens?.customer_id ||
    extractCustomerIdFromJwt(tokens?.access_token) ||
    extractCustomerIdFromJwt(tokens?.id_token);

  let message: string | undefined;
  if (!mtls.configured) {
    message = mtls.message;
  } else if (!authenticated) {
    message = `Not logged in. Public endpoints (markets, discounts, products, recipes) work once mTLS is configured. Run 'npm run login' for eBons, orders, Bonus, favorites, and basket.`;
  }

  return {
    authenticated,
    hasAccessToken,
    hasRefreshToken,
    ...(expiresAt ? { expiresAt } : {}),
    ...(expiresInSeconds !== undefined ? { expiresInSeconds } : {}),
    ...(tokens?.saved_at ? { savedAt: tokens.saved_at } : {}),
    tokenSource,
    tokensFile: getTokensFilePath(),
    ...(customerId ? { customerId } : {}),
    mtlsConfigured: mtls.configured,
    mtlsSource: mtls.source,
    ...(mtls.certPath ? { mtlsCertPath: mtls.certPath } : {}),
    ...(mtls.keyPath ? { mtlsKeyPath: mtls.keyPath } : {}),
    marketConfig,
    ...(message ? { message } : {}),
  };
}

let stealthConfigured = false;

export async function loginWithBrowser(
  url: string
): Promise<{ redirectUrl: string; close: () => Promise<void> } | null> {
  let chromium: any;
  try {
    const pwe = await import("playwright-extra");
    const stealthMod = await import("puppeteer-extra-plugin-stealth");
    const stealth = (stealthMod as any).default || stealthMod;
    chromium = pwe.chromium;
    if (!stealthConfigured) {
      chromium.use(stealth());
      stealthConfigured = true;
    }
  } catch {
    try {
      const pw = await import("playwright");
      chromium = pw.chromium;
    } catch {
      return null;
    }
  }

  const profileDir = path.join(os.homedir(), ".config", "rewe-mcp", "browser_profile");
  try {
    fs.mkdirSync(profileDir, { recursive: true });
  } catch {
    // Ignore
  }

  const isHeadless = process.env.REWE_HEADLESS === "true" || process.env.CI === "true";

  const launchOptions = {
    headless: isHeadless,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--no-sandbox",
    ],
    viewport: { width: 1280, height: 800 },
  };

  let context: any = null;
  try {
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        channel: "chrome",
        ...launchOptions,
      });
    } catch {
      context = await chromium.launchPersistentContext(profileDir, launchOptions);
    }

    const page = context.pages()[0] || (await context.newPage());

    console.log("\n🌐 Opening REWE SSO login in Chrome...");
    console.log("👉 Please sign in to your REWE account in the browser window.");
    console.log("   (The de.rewe.app://redirect callback will be captured automatically.)\n");

    return await new Promise<{ redirectUrl: string; close: () => Promise<void> } | null>(
      (resolve) => {
        let resolved = false;

        const closeHandler = async () => {
          try {
            await context?.close();
          } catch {
            // Ignore
          }
        };

        const handleUrl = (targetUrl: string) => {
          if (!resolved && isAuthorizationRedirectUrl(targetUrl)) {
            resolved = true;
            console.log("⚡ Captured REWE OAuth redirect callback automatically!");
            resolve({ redirectUrl: targetUrl, close: closeHandler });
          }
        };

        page.on("request", (req: any) => handleUrl(req.url()));
        page.on("requestfailed", (req: any) => handleUrl(req.url()));
        page.on("framenavigated", (frame: any) => {
          if (frame === page.mainFrame()) {
            handleUrl(frame.url());
          }
        });

        page.on("close", () => {
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        });

        page.goto(url).catch(() => {});
      }
    );
  } catch (err) {
    console.warn(`Browser automation failed to launch: ${(err as Error).message}`);
    if (context) {
      try {
        await context.close();
      } catch {
        // Ignore
      }
    }
    return null;
  }
}

function openInSystemBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "darwin") {
    execFile("open", ["-a", "Google Chrome", url], (err) => {
      if (err) {
        execFile("open", [url], () => {});
      }
    });
  } else if (platform === "win32") {
    exec(`start "" "${url}"`);
  } else {
    execFile("xdg-open", [url], () => {});
  }
}

export interface PendingPkceState {
  codeVerifier: string;
  state: string;
  createdAt: string;
}

export function getPkceStateFilePath(): string {
  return path.join(getDefaultConfigDir(), "pkce.json");
}

export function savePendingPkce(
  pending: PendingPkceState,
  filePath: string = getPkceStateFilePath()
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(pending, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore
  }
}

export function loadPendingPkce(
  filePath: string = getPkceStateFilePath()
): PendingPkceState | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PendingPkceState;
    if (parsed?.codeVerifier && parsed?.state) {
      return parsed;
    }
  } catch {
    // Ignore corrupted file
  }
  return null;
}

export async function loginInteractive(opts: {
  manual?: boolean;
  usePlaywright?: boolean;
  redirectInput?: string;
  tokenStore?: TokenStore;
} = {}): Promise<TokensData> {
  if (opts.redirectInput?.trim()) {
    const pending = loadPendingPkce();
    if (!pending) {
      throw new ReweAuthError(
        "MISSING_PKCE_STATE",
        `No pending PKCE state found at ${getPkceStateFilePath()}. Run 'npm run login' first.`
      );
    }
    console.log("=".repeat(60));
    console.log("🔐 REWE MCP LOGIN (Keycloak SSO + PKCE Exchange)");
    console.log("=".repeat(60));
    console.log("\nExchanging authorization code with account.rewe.de...");
    const tokens = await exchangeCode(opts.redirectInput, pending.codeVerifier, {
      save: true,
      tokenStore: opts.tokenStore,
    });
    console.log("✅ Successfully authenticated with REWE!");
    console.log(`📁 Tokens saved to: ${getTokensFilePath()}`);
    console.log(`🔑 Refresh Token: ${tokens.refresh_token ? "Active" : "None"}`);
    return tokens;
  }

  const { codeVerifier, codeChallenge } = generatePkcePair();
  const state = generateState();
  const authUrl = buildAuthUrl({ codeChallenge, state });
  savePendingPkce({
    codeVerifier,
    state,
    createdAt: new Date().toISOString(),
  });

  console.log("=".repeat(60));
  console.log("🔐 REWE MCP LOGIN (Keycloak SSO + PKCE)");
  console.log("=".repeat(60));

  let capturedUrl: string | null = null;
  let browserHandle: { redirectUrl: string; close: () => Promise<void> } | null = null;

  if (opts.usePlaywright && !opts.manual) {
    try {
      browserHandle = await loginWithBrowser(authUrl);
      if (browserHandle) {
        capturedUrl = browserHandle.redirectUrl;
      }
    } catch {
      // Fallback to system browser prompt
    }
  }

  let codeToExchange = "";

  if (capturedUrl) {
    codeToExchange = capturedUrl;
  } else {
    console.log(
      "\n1. Opening REWE login in Chrome (if it did not open automatically, copy this URL into Chrome):\n"
    );
    console.log(`   ${authUrl}\n`);
    openInSystemBrowser(authUrl);

    console.log(
      "2. First, open Chrome DevTools (Cmd+Option+I on macOS / F12 on Windows/Linux) -> Console.\n" +
        "3. Sign in with your REWE email, password, and 2FA if enabled.\n" +
        '4. Copy the "Failed to launch \'de.rewe.app://redirect?...\'" line from Console and paste it below.\n'
    );

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const answer = await rl.question("Paste the redirect URL, console line, or code here: ");
      codeToExchange = answer.trim();
    } finally {
      rl.close();
    }
  }

  if (!codeToExchange) {
    if (browserHandle) await browserHandle.close();
    throw new ReweAuthError("LOGIN_ABORTED", "No authorization code provided.");
  }

  console.log("\nExchanging authorization code with account.rewe.de...");
  try {
    const tokens = await exchangeCode(codeToExchange, codeVerifier, {
      save: true,
      tokenStore: opts.tokenStore,
    });
    console.log("✅ Successfully authenticated with REWE!");
    console.log(`📁 Tokens saved to: ${getTokensFilePath()}`);
    console.log(`🔑 Refresh Token: ${tokens.refresh_token ? "Active" : "None"}`);
    return tokens;
  } finally {
    if (browserHandle) {
      await browserHandle.close();
    }
  }
}
