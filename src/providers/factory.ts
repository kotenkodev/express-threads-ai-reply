import type { PostSourceProvider } from "../types/provider.js";
import type { CampaignConfig } from "../types/campaign.js";
import { ScraperPostSource } from "./scraper/source.js";
import { MockPostSource } from "./mock/source.js";
import { env } from "../config/env.js";

/**
 * Registry of available post source providers (scrapers).
 * Easily extensible for future third-party scrapers (Apify, Crawlbase, RapidAPI, direct scrapers, etc.).
 */
const sourceProviders: Record<string, PostSourceProvider> = {
  scraper: new ScraperPostSource(),
  mock: new MockPostSource(),
};

/**
 * Registers a new post source provider / scraper at runtime.
 */
export function registerPostSourceProvider(name: string, provider: PostSourceProvider): void {
  sourceProviders[name.toLowerCase()] = provider;
}

/**
 * Lists all registered post source providers.
 */
export function getRegisteredPostSourceNames(): string[] {
  return Object.keys(sourceProviders);
}

/**
 * Resolves the appropriate PostSourceProvider.
 * Precedence:
 * 1. Force mock if env.USE_MOCK_POSTS is true
 * 2. Explicitly requested provider name
 * 3. Campaign-specific provider (`campaign.sourceProvider`)
 * 4. Environment default (`env.POST_SOURCE_PROVIDER`)
 * 5. Fallback: scraper (Apify / webhooks / built-in)
 */
export function getPostSourceProvider(campaign?: CampaignConfig, requestedName?: string): PostSourceProvider {
  if (env.USE_MOCK_POSTS) {
    return sourceProviders.mock;
  }

  const name = (
    requestedName ||
    campaign?.sourceProvider ||
    env.POST_SOURCE_PROVIDER ||
    "scraper"
  ).toLowerCase();

  const provider = sourceProviders[name];
  if (!provider) {
    console.warn(`Unknown post source provider "${name}", falling back to "scraper".`);
    return sourceProviders.scraper;
  }

  return provider;
}
