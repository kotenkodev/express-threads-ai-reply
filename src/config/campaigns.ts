import { env } from "./env.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadProducts } from "./product-loader.js";
export * from "../types/campaign.js";

const directory = env.PRODUCTS_DIR
  ? resolve(env.PRODUCTS_DIR)
  : fileURLToPath(new URL("../../products/", import.meta.url));
export const campaigns = loadProducts(directory);
