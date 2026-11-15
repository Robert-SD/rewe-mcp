import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MarketConfig, ServiceType, TokensData } from "./types.js";

/**
 * Raised when the stored REWE session cannot be used, renewed, or persisted.
 */
export class ReweAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ReweAuthError";
    this.code = code;
  }
}

export const TOKENS_FILE_ENV_VAR = "REWE_TOKENS_FILE";
export const STORE_FILE_ENV_VAR = "REWE_STORE_FILE";

export function getDefaultConfigDir(): string {
  if (fs.existsSync("/data")) {
    return "/data";
  }
  return path.join(os.homedir(), ".config", "rewe-mcp");
}

/**
 * Resolve the path for tokens.json outside the Git repository.
 *
 * Priority:
 * 1. Explicit REWE_TOKENS_FILE environment variable override
 * 2. Mounted container data volume (/data/tokens.json) if /data exists or file exists
 * 3. User config directory (~/.config/rewe-mcp/tokens.json)
 */
export function getTokensFilePath(): string {
  const envPath = process.env[TOKENS_FILE_ENV_VAR]?.trim();
  if (envPath) return path.resolve(envPath.replace(/^~/, os.homedir()));

  const containerData = "/data/tokens.json";
  if (fs.existsSync(containerData) || fs.existsSync("/data")) {
    return containerData;
  }

  return path.join(os.homedir(), ".config", "rewe-mcp", "tokens.json");
}

/**
 * Resolve the path for store.json outside the Git repository.
 */
export function getMarketConfigFilePath(): string {
  const envPath = process.env[STORE_FILE_ENV_VAR]?.trim();
  if (envPath) return path.resolve(envPath.replace(/^~/, os.homedir()));

  const containerData = "/data/store.json";
  if (fs.existsSync(containerData) || fs.existsSync("/data")) {
    return containerData;
  }

  return path.join(os.homedir(), ".config", "rewe-mcp", "store.json");
}

/**
 * Pluggable store interface for persisting and loading tokens.
 */
export interface TokenStore {
  load(): TokensData | null | Promise<TokensData | null>;
  save(tokens: TokensData): void | Promise<void>;
  assertWritable?(): void | Promise<void>;
  withLock?<T>(fn: (ctx: { waited: boolean }) => Promise<T>): Promise<T>;
}

export class FileTokenStore implements TokenStore {
  constructor(private getFilePath: () => string = getTokensFilePath) {}

  load(): TokensData | null {
    const filePath = this.getFilePath();
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(content) as TokensData;
      } catch (error: any) {
        console.error(
          `[rewe-mcp] WARNING: tokens file exists at ${filePath} but could not be read/parsed ` +
            `(${error?.message || error}). Ignoring corrupted tokens file.`
        );
        return null;
      }
    }
    return null;
  }

  assertWritable(): void {
    const filePath = this.getFilePath();
    try {
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(fs.existsSync(filePath) ? filePath : dir, fs.constants.W_OK);
    } catch (error: any) {
      const reason = error?.message || error?.code || String(error);
      throw new ReweAuthError(
        "TOKENS_NOT_PERSISTED",
        `Could not verify that REWE tokens can be persisted to ${filePath} before refresh (${reason}). ` +
          `Fix the cause above or set ${TOKENS_FILE_ENV_VAR} to a writable path on persistent storage.`
      );
    }
  }

  save(tokens: TokensData): void {
    const filePath = this.getFilePath();
    const dir = path.dirname(filePath);
    const tempPath = path.join(
      dir,
      `.tokens.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    );

    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(tokens, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
      fs.renameSync(tempPath, filePath);
    } catch (error: any) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup failure
      }
      const reason = error?.message || error?.code || String(error);
      throw new ReweAuthError(
        "TOKENS_NOT_PERSISTED",
        `Could not persist REWE tokens to ${filePath} (${reason}). Fix the cause above or set ${TOKENS_FILE_ENV_VAR} to a writable path.`
      );
    }

    try {
      fs.chmodSync(filePath, 0o600);
    } catch (error: any) {
      console.error(
        `[rewe-mcp] WARNING: tokens written to ${filePath} but chmod 600 failed (${error?.code || error?.message || error}).`
      );
    }
  }

  getLockFilePath(): string {
    const filePath = this.getFilePath();
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    return path.join(dir, `.${base}.lock`);
  }

  async acquireLock(
    timeoutMs = 15000,
    staleMs = 10000
  ): Promise<{ release: () => void; waited: boolean }> {
    const lockPath = this.getLockFilePath();
    const dir = path.dirname(lockPath);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Ignore
    }

    const start = Date.now();
    let waited = false;
    const owner = crypto.randomUUID();
    const host = os.hostname();

    while (true) {
      try {
        const fd = fs.openSync(
          lockPath,
          fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
          0o600
        );
        try {
          fs.writeFileSync(
            fd,
            JSON.stringify({ pid: process.pid, host, owner, createdAt: Date.now() }),
            "utf-8"
          );
        } finally {
          fs.closeSync(fd);
        }

        return {
          release: () => {
            try {
              if (fs.existsSync(lockPath)) {
                const cur = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
                if (cur?.owner === owner) {
                  fs.unlinkSync(lockPath);
                }
              }
            } catch {
              // Ignore lock cleanup failure
            }
          },
          waited,
        };
      } catch (err: any) {
        if (err?.code !== "EEXIST") {
          return { release: () => {}, waited: false };
        }
        waited = true;

        try {
          const content = fs.readFileSync(lockPath, "utf-8");
          const info = JSON.parse(content);
          const age = Date.now() - (info.createdAt || 0);
          const sameHost = !info.host || info.host === host;
          let isDead = false;
          if (sameHost && typeof info.pid === "number" && process.platform !== "win32") {
            try {
              process.kill(info.pid, 0);
            } catch (killErr: any) {
              if (killErr?.code === "ESRCH") {
                isDead = true;
              }
            }
          }

          if (isDead || (!sameHost && age > staleMs) || age > staleMs * 2) {
            try {
              fs.unlinkSync(lockPath);
              continue;
            } catch {
              // Ignore race
            }
          }
        } catch {
          try {
            const stat = fs.statSync(lockPath);
            if (Date.now() - stat.mtimeMs > 5000) {
              fs.unlinkSync(lockPath);
              continue;
            }
          } catch {
            // Ignore
          }
        }

        if (Date.now() - start > timeoutMs) {
          throw new ReweAuthError(
            "LOCK_TIMEOUT",
            `Timed out waiting for REWE token file lock at ${lockPath}.`
          );
        }

        await new Promise((r) => setTimeout(r, 40 + Math.random() * 40));
      }
    }
  }

  async withLock<T>(fn: (ctx: { waited: boolean }) => Promise<T>): Promise<T> {
    const { release, waited } = await this.acquireLock();
    try {
      return await fn({ waited });
    } finally {
      release();
    }
  }
}

export class MemoryTokenStore implements TokenStore {
  private tokens: TokensData | null = null;
  private lockPromise: Promise<void> = Promise.resolve();
  private pendingLocks = 0;

  constructor(initialTokens?: TokensData | null) {
    this.tokens = initialTokens ?? null;
  }

  load(): TokensData | null {
    return this.tokens;
  }

  save(tokens: TokensData): void {
    this.tokens = tokens;
  }

  assertWritable(): void {}

  async withLock<T>(fn: (ctx: { waited: boolean }) => Promise<T>): Promise<T> {
    const waited = this.pendingLocks > 0;
    this.pendingLocks++;
    let release: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prevLock = this.lockPromise;
    this.lockPromise = nextLock;
    await prevLock;
    try {
      return await fn({ waited });
    } finally {
      this.pendingLocks--;
      release!();
    }
  }
}

export class HttpTokenStore implements TokenStore {
  constructor(private url: string, private authHeader?: string) {}

  async load(): Promise<TokensData | null> {
    try {
      const res = await fetch(this.url, {
        headers: this.authHeader ? { Authorization: this.authHeader } : {},
      });
      if (!res.ok) return null;
      return (await res.json()) as TokensData;
    } catch (error: any) {
      console.error(`[rewe-mcp] WARNING: failed to load tokens from ${this.url}: ${error.message}`);
      return null;
    }
  }

  async assertWritable(): Promise<void> {}

  async save(tokens: TokensData): Promise<void> {
    try {
      const res = await fetch(this.url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(this.authHeader ? { Authorization: this.authHeader } : {}),
        },
        body: JSON.stringify(tokens),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (error: any) {
      throw new ReweAuthError(
        "TOKENS_NOT_PERSISTED",
        `Could not persist REWE tokens to ${this.url} (${error.message}).`
      );
    }
  }
}

let activeTokenStore: TokenStore | null = null;

export function getTokenStore(): TokenStore {
  if (!activeTokenStore) {
    if (process.env.REWE_TOKEN_STORE_URL) {
      activeTokenStore = new HttpTokenStore(
        process.env.REWE_TOKEN_STORE_URL,
        process.env.REWE_TOKEN_STORE_AUTH
      );
    } else {
      activeTokenStore = new FileTokenStore();
    }
  }
  return activeTokenStore;
}

export function setTokenStore(store: TokenStore | null): void {
  activeTokenStore = store;
}

export function loadTokens(store?: TokenStore): TokensData | null | Promise<TokensData | null> {
  return (store || getTokenStore()).load();
}

export function assertTokensPathWritable(store?: TokenStore): void | Promise<void> {
  const target = store || getTokenStore();
  if (target.assertWritable) {
    return target.assertWritable();
  }
}

export function saveTokens(tokens: TokensData, store?: TokenStore): void | Promise<void> {
  return (store || getTokenStore()).save(tokens);
}

/**
 * Resolve refresh token with stored token taking precedence over environment bootstrap.
 */
export function resolveRefreshToken(tokens: TokensData | null): {
  token: string | null;
  source: "file" | "env" | null;
} {
  const stored = tokens?.refresh_token?.trim();
  if (stored) return { token: stored, source: "file" };

  const fromEnv = process.env.REWE_REFRESH_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: "env" };

  return { token: null, source: null };
}

export function resolveEnvMarketConfig(): MarketConfig {
  const rawService = (process.env.REWE_SERVICE_TYPE || "PICKUP").toUpperCase();
  const serviceType: ServiceType = rawService === "DELIVERY" ? "DELIVERY" : "PICKUP";
  return {
    marketId: process.env.REWE_MARKET_ID?.trim() || "840174",
    zipCode: process.env.REWE_ZIP_CODE?.trim() || "50667",
    serviceType,
  };
}

export function loadMarketConfig(filePath: string = getMarketConfigFilePath()): MarketConfig {
  const envDefaults = resolveEnvMarketConfig();
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<MarketConfig>;
      const serviceType: ServiceType =
        parsed.serviceType === "DELIVERY" || parsed.serviceType === "PICKUP"
          ? parsed.serviceType
          : envDefaults.serviceType;
      return {
        marketId: parsed.marketId?.trim() || envDefaults.marketId,
        zipCode: parsed.zipCode?.trim() || envDefaults.zipCode,
        serviceType,
        ...(parsed.marketName ? { marketName: parsed.marketName } : {}),
        ...(parsed.city ? { city: parsed.city } : {}),
        ...(parsed.updatedAt ? { updatedAt: parsed.updatedAt } : {}),
      };
    }
  } catch {
    // Ignore corrupted store config file and use defaults
  }
  return envDefaults;
}

export function saveMarketConfig(
  update: Partial<MarketConfig>,
  filePath: string = getMarketConfigFilePath()
): MarketConfig {
  const current = loadMarketConfig(filePath);
  const serviceType: ServiceType =
    update.serviceType === "DELIVERY" || update.serviceType === "PICKUP"
      ? update.serviceType
      : current.serviceType;
  const next: MarketConfig = {
    marketId: update.marketId?.trim() || current.marketId,
    zipCode: update.zipCode?.trim() || current.zipCode,
    serviceType,
    ...(update.marketName !== undefined
      ? update.marketName
        ? { marketName: update.marketName }
        : {}
      : current.marketName
        ? { marketName: current.marketName }
        : {}),
    ...(update.city !== undefined
      ? update.city
        ? { city: update.city }
        : {}
      : current.city
        ? { city: current.city }
        : {}),
    updatedAt: new Date().toISOString(),
  };

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  return next;
}
