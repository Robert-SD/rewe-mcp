import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ReweClient } from "../client.js";
import { withJsonTool } from "./helpers.js";
import {
  recipeDetailsOutputSchema,
  recipePopularTermsOutputSchema,
  searchRecipesOutputSchema,
} from "./schemas.js";

export function registerRecipeTools(server: McpServer, c: ReweClient): void {
  server.registerTool(
    "rewe_search_recipes",
    {
      title: "Search REWE Recipes",
      description:
        "Search REWE recipe database by keyword, difficulty, collection, or tags.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        searchTerm: z
          .string()
          .optional()
          .describe("Keyword or dish name (e.g. 'Lachs', 'Pasta', 'Curry')."),
        page: z.number().int().min(1).optional().default(1),
        objectsPerPage: z.number().int().min(1).max(50).optional().default(20),
        difficulty: z
          .string()
          .optional()
          .describe("Optional difficulty filter ('1'/'easy', '2'/'medium', '3'/'hard')."),
        collection: z
          .string()
          .optional()
          .describe("Optional recipe collection (e.g. 'Vegetarisch', 'Fleisch', 'Fisch', 'Backen')."),
        tags: z.array(z.string()).optional().describe("Optional lowercase recipe tags (e.g. ['vegan', 'gesund'])."),
        sorting: z.string().optional(),
      }),
      outputSchema: searchRecipesOutputSchema,
    },
    withJsonTool((args) => c.searchRecipes(args))
  );

  server.registerTool(
    "rewe_get_recipe_details",
    {
      title: "Get REWE Recipe Ingredients & Preparation Steps",
      description:
        "Fetch complete REWE recipe details by `recipeId`: portion yield, preparation/cooking times, structured ingredients list, step-by-step instructions, and nutrition values.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        recipeId: z.string().min(1).describe("REWE recipe ID (e.g. 'blt4aaa7361ba69f8c8')."),
      }),
      outputSchema: recipeDetailsOutputSchema,
    },
    withJsonTool(({ recipeId }) => c.getRecipeDetails(recipeId))
  );

  server.registerTool(
    "rewe_get_recipe_popular_terms",
    {
      title: "Get Popular REWE Recipe Search Terms",
      description:
        "Fetch trending/popular recipe search terms shown on the REWE recipes landing page.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({}),
      outputSchema: recipePopularTermsOutputSchema,
    },
    withJsonTool(async () => {
      const terms = await c.getRecipePopularTerms();
      return { count: terms.length, terms };
    })
  );
}
