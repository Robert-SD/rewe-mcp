import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ReweApiError } from "./errors.js";
import { MtlsCertSource, MtlsCertStatus } from "./types.js";

export interface LoadedMtlsCredentials {
  cert: string;
  key: string;
  certPath?: string;
  keyPath?: string;
  source: MtlsCertSource;
}

export function getDefaultCertDir(): string {
  return path.join(os.homedir(), ".config", "rewe-mcp", "certs");
}

function resolveMaybeInlineOrFile(value: string): { content: string; filePath?: string } {
  const trimmed = value.trim();
  if (trimmed.includes("-----BEGIN ")) {
    return { content: trimmed };
  }
  const resolved = path.resolve(trimmed.replace(/^~/, os.homedir()));
  if (!fs.existsSync(resolved)) {
    throw new ReweApiError(
      "MTLS_REQUIRED",
      `mTLS file referenced by environment variable does not exist: ${resolved}`
    );
  }
  return {
    content: fs.readFileSync(resolved, "utf-8"),
    filePath: resolved,
  };
}

function findCertPairInDir(
  dir: string
): { certPath: string; keyPath: string } | null {
  if (!fs.existsSync(dir)) return null;
  const certCandidates = [
    path.join(dir, "certificate.pem"),
    path.join(dir, "private.pem"),
    path.join(dir, "cert.pem"),
  ];
  const keyCandidates = [
    path.join(dir, "private.key"),
    path.join(dir, "key.pem"),
  ];

  const certPath = certCandidates.find((p) => fs.existsSync(p));
  const keyPath = keyCandidates.find((p) => fs.existsSync(p));
  if (certPath && keyPath) {
    return { certPath, keyPath };
  }
  return null;
}

/**
 * Load mTLS credentials from:
 * 1. REWE_MTLS_CERT + REWE_MTLS_KEY (PEM file paths or inline PEM strings)
 * 2. /data/certs/(certificate.pem|private.pem) + private.key
 * 3. ~/.config/rewe-mcp/certs/(certificate.pem|private.pem) + private.key
 */
export function loadMtlsCredentials(): LoadedMtlsCredentials {
  const envCert = process.env.REWE_MTLS_CERT;
  const envKey = process.env.REWE_MTLS_KEY;
  if (envCert && envKey) {
    const certRes = resolveMaybeInlineOrFile(envCert);
    const keyRes = resolveMaybeInlineOrFile(envKey);
    return {
      cert: certRes.content,
      key: keyRes.content,
      certPath: certRes.filePath,
      keyPath: keyRes.filePath,
      source: "env",
    };
  }

  const containerPair = findCertPairInDir("/data/certs");
  if (containerPair) {
    return {
      cert: fs.readFileSync(containerPair.certPath, "utf-8"),
      key: fs.readFileSync(containerPair.keyPath, "utf-8"),
      certPath: containerPair.certPath,
      keyPath: containerPair.keyPath,
      source: "container",
    };
  }

  const configPair = findCertPairInDir(getDefaultCertDir());
  if (configPair) {
    return {
      cert: fs.readFileSync(configPair.certPath, "utf-8"),
      key: fs.readFileSync(configPair.keyPath, "utf-8"),
      certPath: configPair.certPath,
      keyPath: configPair.keyPath,
      source: "config_dir",
    };
  }

  throw new ReweApiError(
    "MTLS_REQUIRED",
    `REWE mTLS client certificate not found. Place certificate.pem and private.key in ${getDefaultCertDir()} or set REWE_MTLS_CERT and REWE_MTLS_KEY.`
  );
}

function inspectX509Metadata(certPem: string): {
  subject?: string;
  issuer?: string;
  validTo?: string;
} {
  try {
    const x509 = new crypto.X509Certificate(certPem);
    return {
      subject: x509.subject,
      issuer: x509.issuer,
      validTo: x509.validTo,
    };
  } catch {
    return {};
  }
}

export function getMtlsStatus(): MtlsCertStatus {
  try {
    const creds = loadMtlsCredentials();
    const meta = inspectX509Metadata(creds.cert);
    return {
      configured: true,
      source: creds.source,
      ...(creds.certPath ? { certPath: creds.certPath } : {}),
      ...(creds.keyPath ? { keyPath: creds.keyPath } : {}),
      ...meta,
    };
  } catch (err: any) {
    return {
      configured: false,
      source: "none",
      message: err?.message || "mTLS certificate not configured.",
    };
  }
}
