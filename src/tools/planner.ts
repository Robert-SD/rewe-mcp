import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ReweClient } from "../client.js";
import { marketIdField, withJsonTool, zipCodeField } from "./helpers.js";
import { regularProductsOutputSchema, tripPlanOutputSchema } from "./schemas.js";

export function registerPlannerTools(server: McpServer, c: ReweClient): void {
  server.registerTool(
    "rewe_regular_products",
    {
      title: "Analyze Regular REWE Products from Purchase History",
      description:
        "Analyze previously purchased products and online order history to identify frequently bought groceries, average prices, purchase cadence, and items due for restock.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        maxOrders: z
          .number()
          .int()
          .min(1)
          .max(40)
          .optional()
          .default(15)
          .describe("Maximum number of recent online orders to inspect (default: 15)."),
        minPurchases: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .default(1)
          .describe("Minimum purchase count threshold (default: 1)."),
        limit: z.number().int().min(1).max(200).optional().default(50),
      }),
      outputSchema: regularProductsOutputSchema,
    },
    withJsonTool((args) => c.getRegularProducts(args))
  );

  server.registerTool(
    "rewe_plan_grocery_trip",
    {
      title: "Plan REWE Grocery Trip with Current Offers & Coupons",
      description:
        "Cross-reference your regular REWE products and extra shopping list items against current weekly stationary discounts and REWE Bonus coupons.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        marketId: marketIdField,
        zipCode: zipCodeField,
        maxOrders: z.number().int().min(1).max(40).optional().default(15),
        minPurchases: z.number().int().min(1).max(20).optional().default(1),
        extraItems: z
          .array(z.string().min(1))
          .optional()
          .describe("Additional shopping list items to match against active offers and Bonus coupons."),
        onlyDiscounted: z
          .boolean()
          .optional()
          .describe("If true, omit regular items that have no current offer or coupon match."),
      }),
      outputSchema: tripPlanOutputSchema,
    },
    withJsonTool((args) => c.planGroceryTrip(args))
  );
}
