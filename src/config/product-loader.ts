import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CampaignConfig } from "../types/campaign.js";
import { productSchema } from "./product-schema.js";

export function parseProduct(value: unknown, source = "product"): CampaignConfig {
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
    sourceProvider: p.listening.provider,
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
      threadsUserId: p.publishing.userId,
      accessTokenEnvVar: p.publishing.credentialVariable,
      dailyReplyLimit: p.publishing.dailyBudget,
      activeHoursStart: p.publishing.window.fromHour,
      activeHoursEnd: p.publishing.window.untilHour,
      timeZone: p.publishing.window.timeZone,
      minDelaySeconds: 0,
      maxDelaySeconds: 0,
    },
  };
}

export function loadProducts(directory: string): CampaignConfig[] {
  const files = readdirSync(directory).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) {
    throw new Error(`No product JSON files found in ${directory}`);
  }

  const ids = new Set<string>();
  const products: CampaignConfig[] = [];

  for (const file of files) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(join(directory, file), "utf8"));
    } catch {
      throw new Error(`Cannot parse product JSON: ${file}`);
    }

    const items = Array.isArray(data) ? data : [data];
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
    throw new Error(`No products defined in ${directory}`);
  }

  return products;
}
