import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ReweClient } from "../client.js";
import { withJsonTool } from "./helpers.js";
import {
  authStatusOutputSchema,
  bonusOutputSchema,
  couponsOutputSchema,
  memberProfileOutputSchema,
} from "./schemas.js";

export function registerAccountTools(server: McpServer, c: ReweClient): void {
  server.registerTool(
    "rewe_auth_status",
    {
      title: "Check REWE OAuth & mTLS Certificate Status",
      description:
        "Inspect current REWE Keycloak SSO session status (token source, expiry, customerId), Cloudflare mTLS client certificate configuration, and active default market selection.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({}),
      outputSchema: authStatusOutputSchema,
    },
    withJsonTool(() => c.getAuthStatus())
  );

  server.registerTool(
    "rewe_get_profile",
    {
      title: "Get REWE Member Profile",
      description:
        "Fetch authenticated REWE SSO userinfo, customer profile, REWE ID, and configured store settings.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({}),
      outputSchema: memberProfileOutputSchema,
    },
    withJsonTool(() => c.getProfile())
  );

  server.registerTool(
    "rewe_get_bonus",
    {
      title: "Get REWE Bonus Balance & Loyalty Overview",
      description:
        "Fetch your REWE Bonus euro credit balance, loyalty points overview, tier status, and active article missions.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({}),
      outputSchema: bonusOutputSchema,
    },
    withJsonTool(() => c.getBonusSummary())
  );

  server.registerTool(
    "rewe_get_coupons",
    {
      title: "Get REWE Bonus & App Coupons",
      description:
        "Fetch available and activated REWE Bonus and personal digital app coupons.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({}),
      outputSchema: couponsOutputSchema,
    },
    withJsonTool(async () => {
      const coupons = await c.getBonusCoupons();
      return {
        count: coupons.length,
        coupons,
      };
    })
  );
}
