import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getMtlsStatus, loadMtlsCredentials } from "../src/certs.js";
import { ReweApiError } from "../src/errors.js";

function generateTestPemPair(workDir: string): { certPath: string; keyPath: string } {
  const keyPath = path.join(workDir, "private.key");
  const certPath = path.join(workDir, "certificate.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      "/CN=rewe-test-client",
      "-days",
      "7",
    ],
    { stdio: "pipe" }
  );
  return { certPath, keyPath };
}

test("certs: loadMtlsCredentials & getMtlsStatus resolve REWE_MTLS_CERT / REWE_MTLS_KEY paths and inline PEMs", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rewe-mcp-certs-"));
  const { certPath, keyPath } = generateTestPemPair(tmpRoot);
  const certPem = fs.readFileSync(certPath, "utf-8");
  const keyPem = fs.readFileSync(keyPath, "utf-8");

  const prevCert = process.env.REWE_MTLS_CERT;
  const prevKey = process.env.REWE_MTLS_KEY;
  try {
    // 1. File paths via env vars
    process.env.REWE_MTLS_CERT = certPath;
    process.env.REWE_MTLS_KEY = keyPath;
    const loadedFromPath = loadMtlsCredentials();
    assert.strictEqual(loadedFromPath.source, "env");
    assert.strictEqual(loadedFromPath.certPath, certPath);
    assert.strictEqual(loadedFromPath.keyPath, keyPath);
    assert.ok(loadedFromPath.cert.includes("BEGIN CERTIFICATE"));

    const status = getMtlsStatus();
    assert.strictEqual(status.configured, true);
    assert.strictEqual(status.source, "env");
    assert.ok(status.subject?.includes("rewe-test-client"));

    // 2. Inline PEM strings via env vars
    process.env.REWE_MTLS_CERT = certPem;
    process.env.REWE_MTLS_KEY = keyPem;
    const loadedInline = loadMtlsCredentials();
    assert.strictEqual(loadedInline.source, "env");
    assert.strictEqual(loadedInline.certPath, undefined);
    assert.ok(loadedInline.key.includes("PRIVATE KEY"));
  } finally {
    if (prevCert === undefined) delete process.env.REWE_MTLS_CERT;
    else process.env.REWE_MTLS_CERT = prevCert;
    if (prevKey === undefined) delete process.env.REWE_MTLS_KEY;
    else process.env.REWE_MTLS_KEY = prevKey;
  }
});

test("certs: missing env certificate throws MTLS_REQUIRED", () => {
  const prevCert = process.env.REWE_MTLS_CERT;
  const prevKey = process.env.REWE_MTLS_KEY;
  process.env.REWE_MTLS_CERT = "/nonexistent/cert.pem";
  process.env.REWE_MTLS_KEY = "/nonexistent/key.key";
  try {
    assert.throws(
      () => loadMtlsCredentials(),
      (err: unknown) =>
        err instanceof ReweApiError && err.code === "MTLS_REQUIRED"
    );
  } finally {
    if (prevCert === undefined) delete process.env.REWE_MTLS_CERT;
    else process.env.REWE_MTLS_CERT = prevCert;
    if (prevKey === undefined) delete process.env.REWE_MTLS_KEY;
    else process.env.REWE_MTLS_KEY = prevKey;
  }
});
