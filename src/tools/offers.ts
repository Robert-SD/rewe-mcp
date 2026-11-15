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
  brochureOutputSchema,
  discountsOutputSchema,
  productDetailsOutputSchema,
  recallsOutputSchema,
  searchDiscountsOutputSchema,
  searchProductsOutputSchema,
  shopCategoriesOutputSchema,
} from "./schemas.js";

export function registerOfferTools(server: McpServer, c: ReweClient): void {
  server.registerTool(
    "rewe_get_discounts",
    {
      title: "Get Weekly REWE Store Discounts (Angebote)",
      description:
        "Fetch current weekly promotional offers/discounts for a REWE market grouped by category.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        marketId: marketIdField,
        zipCode: zipCodeField,
        categoryId: z
          .string()
          .optional()
          .describe("Optional category ID or title substring to filter offers."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Optional maximum number of total offers to return."),
      }),
      outputSchema: discountsOutputSchema,
    },
    withJsonTool((args) => c.getMarketDiscounts(args))
  );

  server.registerTool(
    "rewe_search_discounts",
    {
      title: "Search Weekly REWE Discounts by Keyword",
      description:
        "Search current weekly stationary offers at the selected REWE market by product name, brand, or category keyword.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        query: z.string().min(1).describe("Keyword to match against weekly offers (e.g. 'Milch', 'Haribo', 'Kaffee')."),
        marketId: marketIdField,
        zipCode: zipCodeField,
        limit: z.number().int().min(1).max(200).optional(),
      }),
      outputSchema: searchDiscountsOutputSchema,
    },
    withJsonTool(({ query, marketId, zipCode, limit }) =>
      c.searchDiscounts(query, { marketId, zipCode, limit })
    )
  );

  server.registerTool(
    "rewe_get_brochure",
    {
      title: "Get REWE Weekly Brochure / Prospekt Metadata",
      description:
        "Fetch digital stationary handout/brochure (Prospekt) metadata for a REWE market.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        marketId: marketIdField,
      }),
      outputSchema: brochureOutputSchema,
    },
    withJsonTool(async ({ marketId }) => {
      const resolvedId = marketId || c.getSelectedMarket().marketId;
      const handout = await c.getStationaryHandout(resolvedId);
      return { marketId: resolvedId, handout };
    })
  );

  server.registerTool(
    "rewe_search_products",
    {
      title: "Search REWE Product Catalog",
      description:
        "Search the live REWE supermarket assortment for a market and service type (`PICKUP` or `DELIVERY`) by product name, EAN barcode, or category slug.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Search term or EAN barcode (e.g. 'Hafermilch', '4305615100005'). Leave empty when browsing a categorySlug."),
        categorySlug: z
          .string()
          .optional()
          .describe("Optional category slug from rewe_get_shop_categories (e.g. 'obst-gemuese')."),
        page: z.number().int().min(1).optional().default(1),
        objectsPerPage: z.number().int().min(1).max(80).optional().default(30),
        filters: z
          .array(z.string())
          .optional()
          .describe("Optional REWE attribute filters such as 'attribute=organic', 'attribute=vegan', 'attribute=regional', 'attribute=vegetarian'."),
        sort: z.string().optional(),
        marketId: marketIdField,
        zipCode: zipCodeField,
        serviceType: serviceTypeField,
      }),
      outputSchema: searchProductsOutputSchema,
    },
    withJsonTool((args) => c.searchProducts(args))
  );

  server.registerTool(
    "rewe_get_product_details",
    {
      title: "Get REWE Product Details & Nutrition",
      description:
        "Fetch detailed product information including description, ingredients, allergens, nutrition table, GTIN, and listing price.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        productId: z.string().min(1).describe("REWE productId from rewe_search_products."),
        marketId: marketIdField,
        zipCode: zipCodeField,
        serviceType: serviceTypeField,
      }),
      outputSchema: productDetailsOutputSchema,
    },
    withJsonTool(({ productId, marketId, zipCode, serviceType }) =>
      c.getProductDetails(productId, { marketId, zipCode, serviceType })
    )
  );

  server.registerTool(
    "rewe_get_shop_categories",
    {
      title: "Get REWE Shop Categories",
      description:
        "List top-level and nested REWE online shop categories (`slug`, product counts) available for a market and service type.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        marketId: marketIdField,
        zipCode: zipCodeField,
        serviceType: serviceTypeField,
      }),
      outputSchema: shopCategoriesOutputSchema,
    },
    withJsonTool(async ({ marketId, zipCode, serviceType }) => {
      const categories = await c.getShopCategories({
        marketId,
        zipCode,
        serviceType,
      });
      return { count: categories.length, categories };
    })
  );

  server.registerTool(
    "rewe_get_product_recalls",
    {
      title: "Get REWE Product Recalls",
      description:
        "Fetch active REWE product safety recalls (Produktrückrufe).",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({}),
      outputSchema: recallsOutputSchema,
    },
    withJsonTool(async () => {
      const recalls = await c.getProductRecalls();
      return { count: recalls.length, recalls };
    })
  );
}
