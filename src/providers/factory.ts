import type { PostSourceProvider, PostPublishProvider } from "../types/provider.js";
import type { CampaignConfig } from "../types/campaign.js";
import { MetaThreadsPostSource } from "./threads/source.js";
import { MetaThreadsPublisher } from "./threads/publisher.js";
import { ScraperPostSource } from "./scraper/source.js";
import { MockPostSource } from "./mock/source.js";
import { MockPublisher } from "./mock/publisher.js";
import { env } from "../config/env.js";

const sourceProviders: Record<string, PostSourceProvider> = {
  threads_api: new MetaThreadsPostSource(),
  scraper: new ScraperPostSource(),
  mock: new MockPostSource(),
};

const publishProviders: Record<string, PostPublishProvider> = {
  threads_api: new MetaThreadsPublisher(),
  mock: new MockPublisher(),
};

/**
 * Resolves the appropriate PostSourceProvider.
 * Precedence:
 * 1. Force mock if env.USE_MOCK_POSTS is true
 * 2. Campaign-specific provider (`campaign.sourceProvider`)
 * 3. Environment default (`env.POST_SOURCE_PROVIDER`)
 * 4. Fallback: threads_api
 */
export function getPostSourceProvider(campaign?: CampaignConfig, requestedName?: string): PostSourceProvider {
  if (env.USE_MOCK_POSTS) {
    return sourceProviders.mock;
  }

  const name =
    requestedName ||
    campaign?.sourceProvider ||
    env.POST_SOURCE_PROVIDER ||
    "threads_api";

  const provider = sourceProviders[name];
  if (!provider) {
    console.warn(`Unknown post source provider "${name}", falling back to "threads_api".`);
    return sourceProviders.threads_api;
  }

  return provider;
}

/**
 * Resolves the appropriate PostPublishProvider.
 * Precedence:
 * 1. Force mock if env.DRY_RUN is true or requested mock
 * 2. Default: threads_api
 */
export function getPostPublishProvider(isDryRun: boolean = env.DRY_RUN): PostPublishProvider {
  if (isDryRun) {
    return publishProviders.mock;
  }
  return publishProviders.threads_api;
}

/**
 * Registers an external/custom source provider at runtime.
 */
export function registerPostSourceProvider(name: string, provider: PostSourceProvider): void {
  sourceProviders[name] = provider;
}

/**
 * Registers an external/custom publish provider at runtime.
 */
export function registerPostPublishProvider(name: string, provider: PostPublishProvider): void {
  publishProviders[name] = provider;
}

