import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ReweClient } from "../client.js";
import { withJsonTool } from "./helpers.js";
import {
  ebonPdfOutputSchema,
  listEbonsOutputSchema,
  listOrdersOutputSchema,
  orderDetailsOutputSchema,
} from "./schemas.js";

export function registerReceiptTools(server: McpServer, c: ReweClient): void {
  server.registerTool(
    "rewe_list_ebons",
    {
      title: "List REWE Digital Store Receipts (eBons)",
      description:
        "List in-store digital receipts (eBons) with timestamps, store address, total spend, and REWE Bonus earned.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).optional().describe("Maximum number of eBons to return."),
      }),
      outputSchema: listEbonsOutputSchema,
    },
    withJsonTool(({ limit }) => c.listEbons(limit))
  );

  server.registerTool(
    "rewe_get_ebon_pdf",
    {
      title: "Download REWE eBon Receipt PDF",
      description:
        "Download the original PDF receipt for a given `ebonId`. Optionally pass `savePath` to write the PDF directly to disk; otherwise returns `base64Pdf` and `sizeBytes`.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: z.object({
        ebonId: z.string().min(1).describe("eBon receipt ID from rewe_list_ebons."),
        savePath: z
          .string()
          .optional()
          .describe("Optional local file path to save the PDF directly (e.g. '~/Downloads/ebon.pdf')."),
      }),
      outputSchema: ebonPdfOutputSchema,
    },
    withJsonTool(({ ebonId, savePath }) => c.getEbonPdf(ebonId, savePath))
  );

  server.registerTool(
    "rewe_list_orders",
    {
      title: "List REWE Online Orders",
      description:
        "List REWE Abholservice (pickup) and Lieferservice (delivery) online order history.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().describe("Maximum number of orders to return."),
      }),
      outputSchema: listOrdersOutputSchema,
    },
    withJsonTool(async ({ limit }) => {
      const orders = await c.listOrders(limit);
      return { count: orders.length, orders };
    })
  );

  server.registerTool(
    "rewe_get_order_details",
    {
      title: "Get REWE Online Order Details",
      description:
        "Fetch full line-item breakdown, quantities, prices, and timeslot details for a REWE online order.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        orderId: z.string().min(1).describe("Online order ID from rewe_list_orders."),
      }),
      outputSchema: orderDetailsOutputSchema,
    },
    withJsonTool(({ orderId }) => c.getOrderDetails(orderId))
  );
}
