import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type { CampaignConfig } from "../types/campaign.js";
import { productSchema } from "./product-schema.js";

function parseProduct(value: unknown, source = "product"): CampaignConfig {
  if (!value || typeof value !== "object") {
    throw new Error(`${source}: product configuration must be an object`);
  }

  const raw = value as Record<string, unknown>;

  // Format 1: Direct / Flat CampaignConfig format (e.g. { id, productName, keywords, productContext, replyGuidelines })
  if (!("product" in raw) && ("productName" in raw || "keywords" in raw || "productContext" in raw)) {
    const id = String(raw.id || raw.key || "").trim();
    if (!id) throw new Error(`${source}: missing required 'id' or 'key'`);
    const productName = String(raw.productName || raw.label || id);
    const keywords = Array.isArray(raw.keywords)
      ? (raw.keywords as string[])
      : Array.isArray(raw.phrases)
      ? (raw.phrases as string[])
      : [];

    if (!keywords.length) {
      throw new Error(`${source}: keywords must be a non-empty array of search phrases`);
    }

    const writing = (raw.writing as Record<string, unknown>) || {};
    const account = (raw.account as Record<string, unknown>) || {};
    const generation = (raw.generation as Record<string, unknown>) || {};

    return {
      id,
      enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : raw.active !== undefined ? Boolean(raw.active) : true,
      productName,
      productUrl: String(raw.productUrl || raw.homepage || "https://threads.com"),
      productContext: String(raw.productContext || raw.description || `${productName} product context`),
      replyGuidelines: String(raw.replyGuidelines || raw.voice || "Helpful, friendly, and natural conversational tone."),
      keywords,
      minConfidenceScore: Number(raw.minConfidenceScore ?? raw.reviewThreshold ?? 75),
      maxPostAgeMinutes: Number(raw.maxPostAgeMinutes ?? raw.freshnessMinutes ?? 7200),
      sourceProvider: (raw.sourceProvider || raw.provider || "scraper") as any,
      searchType: (raw.searchType || raw.ordering || "RECENT") as any,
      inspectPerRun: Number(raw.inspectPerRun ?? 25),
      draftsPerRun: Number(raw.draftsPerRun ?? 5),
      excludeText: (raw.excludeText as string[]) || (raw.skipText as string[]) || [],
      excludeHandles: (raw.excludeHandles as string[]) || (raw.skipHandles as string[]) || [],
      ownHandle: String(raw.ownHandle || ""),
      writing: {
        locale: String(writing.locale || "match-post"),
        characterBudget: Number(writing.characterBudget ?? 400),
        permitLinks: Boolean(writing.permitLinks ?? false),
        forbiddenWording: (writing.forbiddenWording as string[]) || ["download now", "use my code", "link in bio"],
      },
      generation: {
        model: generation.model ? String(generation.model) : undefined,
        endpoint: generation.endpoint ? String(generation.endpoint) : undefined,
        credentialVariable: generation.credentialVariable ? String(generation.credentialVariable) : undefined,
        temperature: Number(generation.temperature ?? 0.7),
      },
      account: {
        threadsUserId: String(account.threadsUserId || "me"),
        accessTokenEnvVar: String(account.accessTokenEnvVar || "THREADS_ACCESS_TOKEN"),
        dailyReplyLimit: Number(account.dailyReplyLimit ?? 20),
        activeHoursStart: Number(account.activeHoursStart ?? 9),
        activeHoursEnd: Number(account.activeHoursEnd ?? 22),
        timeZone: String(account.timeZone || "Europe/Kyiv"),
        minDelaySeconds: 0,
        maxDelaySeconds: 0,
      },
    };
  }

  // Format 2: Structured Product Profile schema (key, product: { label, ... }, listening: { ... })
  const result = productSchema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((e) => `${e.path.join(".") || "root"} (${e.message})`)
      .join("; ");
    throw new Error(`${source}: ${details}`);
  }
  const p = result.data;
  return {
    id: p.key,
    enabled: p.active,
    productName: p.product.label,
    productUrl: p.product.homepage,
    productContext: `${p.product.description}\nAudience: ${p.product.audience}\nBenefits: ${p.product.strengths.join("; ")}\nRelevant conversations: ${p.listening.intent}`,
    replyGuidelines: `${p.writing.voice}\n${p.writing.guidance}`,
    keywords: p.listening.phrases,
    minConfidenceScore: p.listening.reviewThreshold,
    maxPostAgeMinutes: p.listening.freshnessMinutes,
    sourceProvider: p.listening.provider as any,
    searchType: p.listening.ordering,
    inspectPerRun: p.listening.inspectPerRun,
    draftsPerRun: p.listening.draftsPerRun,
    excludeText: p.listening.skipText,
    excludeHandles: p.listening.skipHandles,
    ownHandle: p.listening.ownHandle,
    writing: p.writing,
    generation: {
      model: p.generation.model || undefined,
      endpoint: p.generation.endpoint || undefined,
      credentialVariable: p.generation.credentialVariable || undefined,
      temperature: p.generation.temperature,
    },
    account: {
      threadsUserId: p.publishing?.userId || "me",
      accessTokenEnvVar: p.publishing?.credentialVariable || "THREADS_ACCESS_TOKEN",
      dailyReplyLimit: p.publishing?.dailyBudget ?? 20,
      activeHoursStart: p.publishing?.window?.fromHour ?? 9,
      activeHoursEnd: p.publishing?.window?.untilHour ?? 22,
      timeZone: p.publishing?.window?.timeZone || "Europe/Kyiv",
      minDelaySeconds: 0,
      maxDelaySeconds: 0,
    },
  };
}

function parseJsonWithCleanups(rawText: string, file: string): unknown {
  // Strip UTF-8 Byte Order Mark (BOM) if present
  let text = rawText.replace(/^\uFEFF/, "");

  try {
    return JSON.parse(text);
  } catch {
    // Attempt cleanup: remove single-line comments and trailing commas
    try {
      const cleaned = text
        .replace(/(?<!["':\\])\/\/.*$/gm, "")
        .replace(/,\s*([\]}])/g, "$1");
      return JSON.parse(cleaned);
    } catch {
      throw new Error(`Cannot parse product JSON: ${file}`);
    }
  }
}

export function loadProducts(directoryOrFile: string): CampaignConfig[] {
  let stats;
  try {
    stats = statSync(directoryOrFile);
  } catch {
    throw new Error(`Product path does not exist: ${directoryOrFile}`);
  }

  let filePaths: string[] = [];
  if (stats.isFile()) {
    filePaths = [directoryOrFile];
  } else if (stats.isDirectory()) {
    const files = readdirSync(directoryOrFile).filter((f) => f.endsWith(".json")).sort();
    filePaths = files.map((f) => join(directoryOrFile, f));
  }

  if (!filePaths.length) {
    throw new Error(`No product JSON files found in ${directoryOrFile}`);
  }

  const ids = new Set<string>();
  const products: CampaignConfig[] = [];

  for (const filePath of filePaths) {
    const file = basename(filePath);
    let rawText = readFileSync(filePath, "utf8");
    const data = parseJsonWithCleanups(rawText, file);

    // Support:
    // 1. Array of products: [ {...}, {...} ]
    // 2. Wrapped object: { products: [ ... ] } or { campaigns: [ ... ] } or { items: [ ... ] }
    // 3. Single product object: { ... }
    let items: unknown[] = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj.products)) {
        items = obj.products;
      } else if (Array.isArray(obj.campaigns)) {
        items = obj.campaigns;
      } else if (Array.isArray(obj.items)) {
        items = obj.items;
      } else {
        items = [data];
      }
    } else {
      items = [data];
    }

    for (let i = 0; i < items.length; i++) {
      const campaign = parseProduct(items[i], `${file}[${i}]`);
      if (ids.has(campaign.id)) {
        throw new Error(`${file}: duplicate product key '${campaign.id}'`);
      }
      ids.add(campaign.id);
      products.push(campaign);
    }
  }

  if (!products.length) {
    throw new Error(`No products defined in ${directoryOrFile}`);
  }

  return products;
}
