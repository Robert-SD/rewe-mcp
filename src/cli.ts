#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { getTokensFilePath, loginInteractive, refreshTokens } from "./auth.js";
import { getMtlsStatus } from "./certs.js";
import { ReweClient } from "./client.js";

dotenv.config();

export async function showStatusCli(client: ReweClient): Promise<void> {
  const status = await client.getAuthStatus();
  const mtls = getMtlsStatus();
  const cfg = client.getSelectedMarket();

  if (!status.authenticated && process.env.REWE_REFRESH_TOKEN) {
    try {
      await refreshTokens();
    } catch (err: any) {
      console.error(`⚠️ Refresh token bootstrap failed: ${err.message}`);
    }
  }

  console.log("=".repeat(60));
  console.log("🛒 REWE MCP STATUS");
  console.log("=".repeat(60));
  console.log(`mTLS cert:       ${mtls.configured ? `✅ Configured (${mtls.source})` : "❌ Missing"}`);
  if (mtls.certPath) console.log(`  Cert path:     ${mtls.certPath}`);
  if (mtls.keyPath) console.log(`  Key path:      ${mtls.keyPath}`);
  if (mtls.validTo) console.log(`  Valid until:   ${mtls.validTo}`);
  if (!mtls.configured && mtls.message) {
    console.log(`  Note:          ${mtls.message}`);
  }

  console.log(`Tokens file:     ${getTokensFilePath()}`);
  console.log(`OAuth session:   ${status.authenticated ? `✅ Active (${status.tokenSource})` : "⚠️ Not logged in"}`);
  if (status.expiresAt) {
    console.log(`  Expires at:    ${status.expiresAt} (${status.expiresInSeconds}s)`);
  }
  console.log(
    `Selected market: ${cfg.marketId} (PLZ ${cfg.zipCode}, ${cfg.serviceType}${cfg.marketName ? `, ${cfg.marketName}` : ""})`
  );

  const cache = client.cacheStats();
  console.log(
    `Response cache:  ${cache.enabled ? "enabled" : "disabled"} (max ${cache.maxEntries} entries)`
  );

  if (mtls.configured) {
    console.log("\nVerifying live REWE API connection...");
    try {
      const markets = await client.searchMarkets(cfg.zipCode);
      const first = markets[0];
      console.log(
        `✅ Mobile Clients API operational (sample store: ${first?.wwIdent || cfg.marketId} ${first?.name || ""})`
      );
    } catch (err: any) {
      console.log(`❌ Market lookup check failed: ${err.message}`);
    }

    if (status.authenticated) {
      try {
        const profile = await client.getProfile();
        console.log(`Customer:        ${profile.fullName || profile.email || profile.customerId || "Authenticated"}`);
        console.log("✅ Authenticated connection healthy!");
      } catch (err: any) {
        console.log(`⚠️ Authenticated profile check failed: ${err.message}`);
      }
    }
  }
}

export async function runCliCommand(
  args: string[],
  client: ReweClient
): Promise<boolean> {
  const cmd = args[0]?.toLowerCase();
  if (!cmd) return false;

  if (cmd === "login") {
    const loginArgs = args.slice(1);
    const manual = loginArgs.includes("--manual");
    const usePlaywright = loginArgs.includes("--browser");
    const redirectInput = loginArgs.find(
      (a) => !a.startsWith("--") && (/de\.rewe\.app:\/\//i.test(a) || /\bcode=/.test(a))
    );
    await loginInteractive({ manual, usePlaywright, redirectInput });
    return true;
  }

  if (cmd === "status") {
    await showStatusCli(client);
    return true;
  }

  return false;
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    const scriptPath = fs.realpathSync(path.resolve(process.argv[1]));
    const modulePath = fs.realpathSync(fileURLToPath(import.meta.url));
    return scriptPath === modulePath;
  } catch {
    return false;
  }
}

if (isDirectExecution() && !process.env.NODE_TEST_CONTEXT) {
  const client = new ReweClient();
  runCliCommand(process.argv.slice(2), client)
    .then((handled) => {
      if (!handled) {
        console.log("Usage: rewe-mcp-cli <login [--manual] | status>");
        process.exit(1);
      }
    })
    .catch((err: any) => {
      console.error(`❌ Error: ${err?.message || err}`);
      process.exit(1);
    });
}
