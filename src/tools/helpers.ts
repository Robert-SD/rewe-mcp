import { z } from "zod";
import { normalizeToolError } from "../errors.js";

export const marketIdField = z
  .string()
  .min(1)
  .max(32)
  .optional()
  .describe("REWE market identifier (wwIdent, e.g. '840174'). Defaults to the configured market.");

export const zipCodeField = z
  .string()
  .min(4)
  .max(10)
  .optional()
  .describe("German postal code (PLZ, e.g. '50667'). Defaults to the configured zip code.");

export const serviceTypeField = z
  .enum(["PICKUP", "DELIVERY"])
  .optional()
  .describe("REWE service type ('PICKUP' for Abholservice or 'DELIVERY' for Lieferservice).");

export function toolError(error: unknown) {
  const payload = normalizeToolError(error);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

export function withJsonTool<TArgs>(
  fn: (args: TArgs) => Promise<unknown>
): (args: TArgs) => Promise<any> {
  return async (args: TArgs) => {
    try {
      const result = await fn(args);
      const text = JSON.stringify(result, null, 2);
      const isPlainObj =
        result !== null && typeof result === "object" && !Array.isArray(result);
      return {
        content: [{ type: "text" as const, text }],
        ...(isPlainObj
          ? { structuredContent: JSON.parse(text) as Record<string, unknown> }
          : {}),
      };
    } catch (error: unknown) {
      return toolError(error);
    }
  };
}
