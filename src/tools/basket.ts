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
  basketOutputSchema,
  favoritesOutputSchema,
  manageFavoriteOutputSchema,
  timeslotsOutputSchema,
} from "./schemas.js";

export function registerBasketTools(server: McpServer, c: ReweClient): void {
  server.registerTool(
    "rewe_get_favorites",
    {
      title: "Get REWE Favorite Product Lists",
      description:
        "Fetch your saved REWE favorite lists along with product details, listingIds, and prices for the configured market.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        includeProducts: z
          .boolean()
          .optional()
          .default(true)
          .describe("Include full product metadata and listingIds (default: true)."),
      }),
      outputSchema: favoritesOutputSchema,
    },
    withJsonTool(async ({ includeProducts }) => {
      const lists = await c.getFavorites({ includeProducts });
      return { count: lists.length, lists };
    })
  );

  server.registerTool(
    "rewe_manage_favorite",
    {
      title: "Add or Remove Product in REWE Favorites List",
      description:
        "Add a product (`listingId`, optional `productId`) to a REWE favorites list or remove an entry (`itemId`) from a favorites list.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: z.object({
        action: z.enum(["add", "remove"]).describe("Whether to 'add' or 'remove' an item."),
        listId: z.string().min(1).describe("Favorites list ID from rewe_get_favorites."),
        listingId: z
          .string()
          .optional()
          .describe("Required when action='add': product listingId."),
        productId: z
          .string()
          .optional()
          .describe("Optional productId when action='add'."),
        quantity: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Optional preferred quantity when action='add'."),
        itemId: z
          .string()
          .optional()
          .describe("Required when action='remove': line item ID (`itemId`) from rewe_get_favorites."),
      }),
      outputSchema: manageFavoriteOutputSchema,
    },
    withJsonTool(async ({ action, listId, listingId, productId, quantity, itemId }) => {
      if (action === "add") {
        const result = await c.addFavorite(listId, listingId || "", {
          productId,
          quantity,
        });
        return { action, listId, result };
      }
      const result = await c.removeFavorite(listId, itemId || "");
      return { action, listId, result };
    })
  );

  server.registerTool(
    "rewe_get_basket",
    {
      title: "Get Current REWE Basket",
      description:
        "Fetch or initialize the active REWE Pickup or Delivery basket for the configured market and return items, totals, version, and minimum order threshold status.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: z.object({
        basketId: z.string().optional().describe("Optional existing basket UUID."),
        marketId: marketIdField,
        zipCode: zipCodeField,
        serviceType: serviceTypeField,
      }),
      outputSchema: basketOutputSchema,
    },
    withJsonTool((args) => c.createOrGetBasket(args))
  );

  server.registerTool(
    "rewe_set_basket_item",
    {
      title: "Set Product Quantity in REWE Basket",
      description:
        "Add a product listing to your REWE Pickup/Delivery basket or update its absolute quantity (set `quantity: 0` to remove the item).",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: z.object({
        listingId: z
          .string()
          .min(1)
          .describe("Product listingId from rewe_search_products or rewe_get_favorites."),
        quantity: z
          .number()
          .int()
          .min(0)
          .describe("Absolute quantity to set in the basket (0 removes the item)."),
        basketId: z
          .string()
          .optional()
          .describe("Optional basketId from rewe_get_basket (auto-resolved if omitted)."),
        version: z
          .number()
          .int()
          .optional()
          .describe("Optional basket version for optimistic concurrency (auto-resolved if omitted)."),
        marketId: marketIdField,
        zipCode: zipCodeField,
        serviceType: serviceTypeField,
      }),
      outputSchema: basketOutputSchema,
    },
    withJsonTool((args) => c.setBasketItemQuantity(args))
  );

  server.registerTool(
    "rewe_get_timeslots",
    {
      title: "Get Available REWE Pickup/Delivery Timeslots",
      description:
        "List available Abholservice (pickup) or Lieferservice (delivery) checkout timeslots and service fees for the current basket and market.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        basketId: z.string().optional(),
        marketId: marketIdField,
        zipCode: zipCodeField,
        serviceType: serviceTypeField,
      }),
      outputSchema: timeslotsOutputSchema,
    },
    withJsonTool(async (args) => {
      const timeslots = await c.getTimeslots(args);
      return { count: timeslots.length, timeslots };
    })
  );
}
