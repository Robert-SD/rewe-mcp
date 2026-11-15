import { ReweApiError } from "../errors.js";
import { mapRecipeDetail, mapRecipeSummary } from "../mappers.js";
import { ReweRecipe, ReweRecipeDetail } from "../types.js";
import { ReweTransport } from "./transport.js";

function mapDifficultyParam(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "1" || trimmed === "easy" || trimmed === "gering" || trimmed === "einfach") {
    return "1";
  }
  if (trimmed === "2" || trimmed === "medium" || trimmed === "mittel") {
    return "2";
  }
  if (trimmed === "3" || trimmed === "hard" || trimmed === "hoch" || trimmed === "schwer") {
    return "3";
  }
  return raw.trim();
}

export async function searchRecipes(
  t: ReweTransport,
  options: {
    searchTerm?: string;
    objectsPerPage?: number;
    page?: number;
    sorting?: string;
    difficulty?: string;
    collection?: string;
    tags?: string[];
  } = {}
): Promise<{
  totalCount: number;
  recipes: ReweRecipe[];
  metadata?: unknown;
}> {
  const page = Math.max(1, options.page ?? 1);
  const objectsPerPage = Math.max(1, Math.min(50, options.objectsPerPage ?? 20));
  const diff = mapDifficultyParam(options.difficulty);

  const data = await t.request<any>("/api/recipes/search", {
    host: "mobile",
    authMode: "none",
    query: {
      searchTerm: options.searchTerm ?? "",
      page,
      objectsPerPage,
      tagConcat: "AND",
      ...(options.sorting ? { sorting: options.sorting } : {}),
      ...(diff ? { difficulties: diff } : {}),
      ...(options.collection ? { collections: options.collection } : {}),
      ...(options.tags?.length ? { tags: options.tags } : {}),
    },
  });

  const block = data?.recipes || data?.recipeSearch || data || {};
  const list: any[] = Array.isArray(block.recipes)
    ? block.recipes
    : Array.isArray(block)
      ? block
      : [];
  const totalCount =
    typeof block.metadata?.totalRecipeCount === "number"
      ? block.metadata.totalRecipeCount
      : list.length;

  return {
    totalCount,
    recipes: list.map(mapRecipeSummary),
    ...(block.metadata ? { metadata: block.metadata } : {}),
  };
}

export async function getRecipeDetails(
  t: ReweTransport,
  recipeId: string
): Promise<ReweRecipeDetail> {
  const id = recipeId.trim();
  if (!id) {
    throw new ReweApiError("INVALID_INPUT", "recipeId must not be empty.");
  }
  const data = await t.request<any>(`/api/recipes/${encodeURIComponent(id)}`, {
    host: "mobile",
    authMode: "none",
  });
  if (data && "recipeById" in data && data.recipeById === null) {
    throw new ReweApiError("NOT_FOUND", `Recipe ${id} not found.`, 404);
  }
  return mapRecipeDetail(data);
}

export async function getRecipePopularTerms(
  t: ReweTransport
): Promise<string[]> {
  const data = await t.request<any>("/api/recipes/search/landing-page", {
    host: "mobile",
    authMode: "none",
  });
  const tags: any[] =
    data?.searchTags?.tags ||
    data?.tags ||
    (Array.isArray(data) ? data : []);
  return tags
    .map((tag) => (typeof tag === "string" ? tag : tag?.title || tag?.term || ""))
    .filter(Boolean);
}

export async function getFavoriteRecipes(t: ReweTransport): Promise<unknown> {
  return t.request<any>("/api/recipes/favorites", {
    host: "mobile",
    authMode: "required",
  });
}
