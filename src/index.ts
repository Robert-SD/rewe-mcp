#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as dotenv from "dotenv";
import { runCliCommand } from "./cli.js";
import { ReweClient } from "./client.js";
import { resolveHttpConfigFromEnv, startHttpServer } from "./http.js";
import { registerAccountTools } from "./tools/account.js";
import { registerBasketTools } from "./tools/basket.js";
import { toolError } from "./tools/helpers.js";
import { registerOfferTools } from "./tools/offers.js";
import { registerPlannerTools } from "./tools/planner.js";
import { registerReceiptTools } from "./tools/receipts.js";
import { registerRecipeTools } from "./tools/recipes.js";
import { registerStoreTools } from "./tools/stores.js";

dotenv.config();

export { toolError };

function loadPackageVersion(): string {
  try {
    const raw = fs.readFileSync(
      new URL("../package.json", import.meta.url),
      "utf-8"
    );
    return JSON.parse(raw).version || "0.1.0";
  } catch {
    return "0.1.0";
  }
}

const SERVER_VERSION = loadPackageVersion();
const defaultClient = new ReweClient();

export function createServer(customClient?: ReweClient): McpServer {
  const c = customClient || defaultClient;
  const server = new McpServer({
    name: "rewe-mcp",
    version: SERVER_VERSION,
  });

  registerAccountTools(server, c);
  registerStoreTools(server, c);
  registerOfferTools(server, c);
  registerRecipeTools(server, c);
  registerReceiptTools(server, c);
  registerBasketTools(server, c);
  registerPlannerTools(server, c);

  return server;
}

function readFlag(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith(`--${name}=`)) {
      return arg.slice(name.length + 3);
    }
    if (arg === `--${name}` && i + 1 < args.length) {
      return args[i + 1];
    }
  }
  return undefined;
}

function isHttpMode(args: string[]): boolean {
  if (args.includes("--http") || args[0]?.toLowerCase() === "http") return true;
  const flag = readFlag(args, "transport")?.toLowerCase();
  if (flag === "http" || flag === "streamable-http") return true;
  const env = process.env.MCP_TRANSPORT?.toLowerCase();
  return env === "http" || env === "streamable-http";
}

async function startStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startStreamableHttp(args: string[]): Promise<void> {
  const portRaw = readFlag(args, "port");
  const port = portRaw !== undefined ? Number.parseInt(portRaw, 10) : undefined;
  const host = readFlag(args, "host");
  const mcpPath = readFlag(args, "path");
  const enableJsonResponse = args.includes("--json") ? true : undefined;

  const config = resolveHttpConfigFromEnv({
    host,
    port: port !== undefined && Number.isFinite(port) ? port : undefined,
    path: mcpPath,
    enableJsonResponse,
    version: SERVER_VERSION,
    client: defaultClient,
  });

  const running = await startHttpServer({
    ...config,
    createServer,
  });

  process.stderr.write(
    `rewe-mcp Streamable HTTP listening on ${running.url} (health: ${running.healthUrl})\n`
  );

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await running.close();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const handled = await runCliCommand(args, defaultClient);
  if (handled) return;

  if (isHttpMode(args)) {
    await startStreamableHttp(args);
  } else {
    await startStdioServer();
  }
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
  main().catch((err) => {
    process.stderr.write(`Fatal error: ${err.message}\n`);
    process.exit(1);
  });
}
