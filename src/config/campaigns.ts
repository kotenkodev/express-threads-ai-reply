import { env } from "./env.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadProducts } from "./product-loader.js";
import type { CampaignConfig } from "../types/campaign.js";

export * from "../types/campaign.js";

function getProductsPath(): string {
  return env.PRODUCTS_DIR
    ? resolve(env.PRODUCTS_DIR)
    : fileURLToPath(new URL("../../products/", import.meta.url));
}

/**
 * Dynamically reloads and returns all product campaigns from disk.
 * Allows newly added/edited product JSON files to be picked up instantly without restarting the server.
 */
export function getCampaigns(): CampaignConfig[] {
  try {
    return loadProducts(getProductsPath());
  } catch (err) {
    console.error("[Campaigns] Error reloading products from disk:", (err as Error).message);
    return campaigns;
  }
}

export const campaigns: CampaignConfig[] = loadProducts(getProductsPath());
