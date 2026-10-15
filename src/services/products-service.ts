import { env } from "../config/env.js";
import { fileURLToPath } from "node:url";
import { resolve, join, basename } from "node:path";
import { readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { loadProducts } from "../config/product-loader.js";
import type { CampaignConfig } from "../types/campaign.js";

export interface EditableProductData {
  id: string;
  active: boolean;
  name: string;
  homepage: string;
  description: string;
  audience: string;
  strengths: string[];
  keywords: string[];
  intent: string;
  voice: string;
  guidance: string;
  reviewThreshold: number;
  skipText: string[];
  characterBudget: number;
  fileName: string;
}

export interface UpdateProductPayload {
  active?: boolean;
  name?: string;
  homepage?: string;
  description?: string;
  audience?: string;
  strengths?: string[];
  keywords?: string[];
  intent?: string;
  voice?: string;
  guidance?: string;
  reviewThreshold?: number;
  skipText?: string[];
  characterBudget?: number;
}

export function getProductsDirectory(): string {
  return env.PRODUCTS_DIR
    ? resolve(env.PRODUCTS_DIR)
    : fileURLToPath(new URL("../../products/", import.meta.url));
}

function parseJsonClean(text: string): any {
  const stripped = text.replace(/^\uFEFF/, "");
  try {
    return JSON.parse(stripped);
  } catch {
    const cleaned = stripped
      .replace(/(?<!["':\\])\/\/.*$/gm, "")
      .replace(/,\s*([\]}])/g, "$1");
    return JSON.parse(cleaned);
  }
}

export function findProductFile(id: string): string | null {
  const dir = getProductsDirectory();
  if (!existsSync(dir)) return null;

  const direct = join(dir, `${id}.json`);
  if (existsSync(direct)) return direct;

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const fullPath = join(dir, file);
    try {
      const data = parseJsonClean(readFileSync(fullPath, "utf8"));
      if (data && (data.key === id || data.id === id)) {
        return fullPath;
      }
    } catch {}
  }
  return null;
}

export function getProductDetails(id: string): EditableProductData | null {
  const filePath = findProductFile(id);
  if (!filePath) return null;

  const raw = parseJsonClean(readFileSync(filePath, "utf8"));
  const fileName = basename(filePath);

  // If structured format
  if (raw.product && raw.listening) {
    return {
      id: raw.key || id,
      active: raw.active !== false,
      name: raw.product.label || id,
      homepage: raw.product.homepage || "",
      description: raw.product.description || "",
      audience: raw.product.audience || "",
      strengths: Array.isArray(raw.product.strengths) ? raw.product.strengths : [],
      keywords: Array.isArray(raw.listening.phrases) ? raw.listening.phrases : [],
      intent: raw.listening.intent || "",
      voice: raw.writing?.voice || "",
      guidance: raw.writing?.guidance || "",
      reviewThreshold: Number(raw.listening.reviewThreshold ?? 75),
      skipText: Array.isArray(raw.listening.skipText) ? raw.listening.skipText : [],
      characterBudget: Number(raw.writing?.characterBudget ?? 400),
      fileName,
    };
  }

  // If flat format
  return {
    id: raw.id || raw.key || id,
    active: raw.enabled !== false && raw.active !== false,
    name: raw.productName || raw.name || id,
    homepage: raw.productUrl || raw.homepage || "",
    description: raw.productContext || raw.description || "",
    audience: "",
    strengths: [],
    keywords: Array.isArray(raw.keywords) ? raw.keywords : Array.isArray(raw.phrases) ? raw.phrases : [],
    intent: "",
    voice: raw.replyGuidelines || raw.voice || "",
    guidance: "",
    reviewThreshold: Number(raw.minConfidenceScore ?? 75),
    skipText: Array.isArray(raw.excludeText) ? raw.excludeText : [],
    characterBudget: Number(raw.writing?.characterBudget ?? 400),
    fileName,
  };
}

export function getAllProductsDetails(): EditableProductData[] {
  const dir = getProductsDirectory();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const list: EditableProductData[] = [];

  for (const file of files) {
    try {
      const fullPath = join(dir, file);
      const raw = parseJsonClean(readFileSync(fullPath, "utf8"));
      const id = raw.key || raw.id || file.replace(/\.json$/, "");
      const details = getProductDetails(id);
      if (details) list.push(details);
    } catch (e) {
      console.warn(`[ProductsService] Skipped invalid JSON file ${file}:`, (e as Error).message);
    }
  }

  return list;
}

export function updateProductDetails(id: string, payload: UpdateProductPayload): EditableProductData {
  const filePath = findProductFile(id);
  if (!filePath) {
    throw new Error(`Product "${id}" not found on disk.`);
  }

  if (payload.keywords !== undefined) {
    if (!Array.isArray(payload.keywords) || payload.keywords.length === 0) {
      throw new Error("Keywords must be a non-empty list of search phrases.");
    }
    payload.keywords = payload.keywords.map((k) => String(k).trim()).filter(Boolean);
    if (payload.keywords.length === 0) {
      throw new Error("At least one valid keyword / search phrase is required.");
    }
  }

  if (payload.reviewThreshold !== undefined) {
    const num = Number(payload.reviewThreshold);
    if (isNaN(num) || num < 0 || num > 100) {
      throw new Error("Review threshold must be a number between 0 and 100.");
    }
  }

  const raw = parseJsonClean(readFileSync(filePath, "utf8"));

  // Structured format update
  if (raw.product && raw.listening) {
    if (payload.active !== undefined) raw.active = Boolean(payload.active);
    if (payload.name !== undefined) raw.product.label = String(payload.name).trim();
    if (payload.homepage !== undefined) raw.product.homepage = String(payload.homepage).trim();
    if (payload.description !== undefined) raw.product.description = String(payload.description).trim();
    if (payload.audience !== undefined) raw.product.audience = String(payload.audience).trim();
    if (payload.strengths !== undefined) raw.product.strengths = payload.strengths;
    if (payload.keywords !== undefined) raw.listening.phrases = payload.keywords;
    if (payload.intent !== undefined) raw.listening.intent = String(payload.intent).trim();
    if (payload.reviewThreshold !== undefined) raw.listening.reviewThreshold = Number(payload.reviewThreshold);
    if (payload.skipText !== undefined) {
      raw.listening.skipText = payload.skipText.map((s) => String(s).trim()).filter(Boolean);
    }
    if (!raw.writing) raw.writing = {};
    if (payload.voice !== undefined) raw.writing.voice = String(payload.voice).trim();
    if (payload.guidance !== undefined) raw.writing.guidance = String(payload.guidance).trim();
    if (payload.characterBudget !== undefined) raw.writing.characterBudget = Number(payload.characterBudget);
  } else {
    // Flat format update
    if (payload.active !== undefined) raw.enabled = Boolean(payload.active);
    if (payload.name !== undefined) raw.productName = String(payload.name).trim();
    if (payload.homepage !== undefined) raw.productUrl = String(payload.homepage).trim();
    if (payload.description !== undefined) raw.productContext = String(payload.description).trim();
    if (payload.keywords !== undefined) raw.keywords = payload.keywords;
    if (payload.voice !== undefined) raw.replyGuidelines = String(payload.voice).trim();
    if (payload.reviewThreshold !== undefined) raw.minConfidenceScore = Number(payload.reviewThreshold);
    if (payload.skipText !== undefined) {
      raw.excludeText = payload.skipText.map((s) => String(s).trim()).filter(Boolean);
    }
    if (payload.characterBudget !== undefined) {
      if (!raw.writing) raw.writing = {};
      raw.writing.characterBudget = Number(payload.characterBudget);
    }
  }

  // Backup existing file content before writing
  const previousContent = readFileSync(filePath, "utf8");
  const newContent = JSON.stringify(raw, null, 2) + "\n";

  try {
    writeFileSync(filePath, newContent, "utf8");
    // Verify file parses properly with system loader
    loadProducts(getProductsDirectory());
  } catch (err) {
    // Rollback to previous content
    writeFileSync(filePath, previousContent, "utf8");
    throw new Error(`Failed to save product configuration: ${(err as Error).message}`);
  }

  const updated = getProductDetails(id);
  if (!updated) {
    throw new Error("Failed to reload updated product details.");
  }
  return updated;
}

export function createNewProduct(payload: {
  id: string;
  name: string;
  keywords: string[];
  homepage?: string;
  description?: string;
  voice?: string;
  guidance?: string;
  reviewThreshold?: number;
}): EditableProductData {
  const dir = getProductsDirectory();
  const key = String(payload.id).toLowerCase().replace(/[^a-z0-9_-]/g, "").trim();
  if (!key) throw new Error("Product ID must contain alphanumeric characters, hyphens or underscores.");

  const filePath = join(dir, `${key}.json`);
  if (existsSync(filePath)) {
    throw new Error(`A product file with key "${key}" already exists (${key}.json).`);
  }

  const keywords = Array.isArray(payload.keywords)
    ? payload.keywords.map((k) => String(k).trim()).filter(Boolean)
    : [];

  if (keywords.length === 0) {
    throw new Error("At least one search keyword / phrase is required.");
  }

  const newDoc = {
    key,
    active: true,
    product: {
      label: String(payload.name || key).trim(),
      homepage: String(payload.homepage || "https://example.com").trim(),
      description: String(payload.description || `${payload.name || key} product description`).trim(),
      audience: "Target users and audience",
      strengths: ["Key benefit 1", "Key benefit 2"],
    },
    listening: {
      phrases: keywords,
      intent: "Conversations where people ask questions or need solutions related to this product.",
      freshnessMinutes: 7200,
      reviewThreshold: Number(payload.reviewThreshold ?? 75),
      inspectPerRun: 25,
      draftsPerRun: 5,
      skipText: ["#ad", "sponsored", "giveaway"],
      skipHandles: [],
    },
    writing: {
      locale: "match-post",
      voice: String(payload.voice || "Helpful, practical, and conversational.").trim(),
      guidance: String(payload.guidance || "Offer practical advice first, then mention the product naturally.").trim(),
      characterBudget: 400,
      permitLinks: false,
      forbiddenWording: ["download now", "use my code", "link in bio"],
    },
  };

  writeFileSync(filePath, JSON.stringify(newDoc, null, 2) + "\n", "utf8");

  // Verify
  try {
    loadProducts(dir);
  } catch (err) {
    // Clean up invalid file
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {}
    }
    throw new Error(`Failed to create product: ${(err as Error).message}`);
  }

  const created = getProductDetails(key);
  if (!created) throw new Error("Product was created but could not be loaded.");
  return created;
}
