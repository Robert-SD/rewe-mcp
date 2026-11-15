import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ReweClient } from "../client.js";
import {
  marketIdField,
  serviceTypeField,
  withJsonTool,
  zipCodeField,
} from "./helpers.js";
import {
  marketConfigSchema,
  marketDetailsOutputSchema,
  searchMarketsOutputSchema,
  servicePortfolioOutputSchema,
} from "./schemas.js";

export function registerStoreTools(server: McpServer, c: ReweClient): void {
  server.registerTool(
    "rewe_search_markets",
    {
      title: "Search REWE Supermarkets",
      description:
        "Search REWE stationary supermarkets by city, street, market name, or German postal code (PLZ).",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("City, street, market name, or zip code (e.g. 'Köln', '50667', 'Berlin Alexanderplatz')."),
      }),
      outputSchema: searchMarketsOutputSchema,
    },
    withJsonTool(async ({ query }) => {
      const markets = await c.searchMarkets(query);
      return {
        count: markets.length,
        markets,
      };
    })
  );

  server.registerTool(
    "rewe_get_market_details",
    {
      title: "Get REWE Market Details",
      description:
        "Fetch full details for a REWE market (`wwIdent`): opening hours, phone number, address, and in-store services.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        marketId: marketIdField,
      }),
      outputSchema: marketDetailsOutputSchema,
    },
    withJsonTool(({ marketId }) => c.getMarketDetails(marketId))
  );

  server.registerTool(
    "rewe_get_service_portfolio",
    {
      title: "Check REWE Pickup & Delivery Availability for Zip Code",
      description:
        "Check whether REWE Lieferservice (delivery) and REWE Abholservice (pickup) are available for a German postal code (PLZ), and list matching market IDs.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        zipCode: zipCodeField,
      }),
      outputSchema: servicePortfolioOutputSchema,
    },
    withJsonTool(({ zipCode }) => c.getServicePortfolio(zipCode))
  );

  server.registerTool(
    "rewe_get_selected_market",
    {
      title: "Get Configured Default REWE Market",
      description:
        "Show the currently active default REWE marketId (`wwIdent`), zipCode (PLZ), and serviceType (`PICKUP` or `DELIVERY`).",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({}),
      outputSchema: marketConfigSchema,
    },
    withJsonTool(async () => c.getSelectedMarket())
  );

  server.registerTool(
    "rewe_set_selected_market",
    {
      title: "Set Default REWE Market & Service Type",
      description:
        "Persist the default REWE marketId (`wwIdent`), zipCode (PLZ), and serviceType (`PICKUP` or `DELIVERY`) in ~/.config/rewe-mcp/store.json for subsequent product, offer, and basket calls.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: z.object({
        marketId: z
          .string()
          .min(1)
          .describe("REWE market identifier (`wwIdent`, e.g. '840174' or '831002')."),
        zipCode: zipCodeField,
        serviceType: serviceTypeField,
        marketName: z.string().optional().describe("Optional display name override."),
        city: z.string().optional().describe("Optional city override."),
      }),
      outputSchema: marketConfigSchema,
    },
    withJsonTool((input) => c.setSelectedMarket(input))
  );
}
