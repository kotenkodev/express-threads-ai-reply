import { getRolling24hSearchCount } from "../db.js";

/**
 * Platform Sourcing & Safety Guardrails:
 * Note: With the Human-in-the-Loop Web Intent pipeline, automated posting
 * anti-ban logic (such as container waiting, posting jitter, and active hours)
 * is no longer needed because publishing is performed manually by a human in
 * their personal browser tab.
 *
 * Sourcing guardrails retained below:
 * 1. Post freshness filter (avoids commenting on stale, outdated discussions)
 * 2. Author cooldown (prevents repeatedly pitching to the same author within 7 days)
 * 3. Search query limits (protects against scraping rate limits)
 */

export const PLATFORM_LIMITS = {
  SEARCHES_PER_24H: 2200,
  AUTHOR_COOLDOWN_DAYS: 7,
};

// Backward-compatibility alias
export const THREADS_PLATFORM_LIMITS = PLATFORM_LIMITS;

export interface GuardrailCheckResult {
  allowed: boolean;
  reason?: string;
  code?: "SEARCH_QUOTA" | "COOLDOWN" | "EXPIRED";
}

/**
 * Verifies if a post was published recently enough to be relevant for a response.
 */
export function isPostFresh(
  createdAtIsoOrSqlite: string,
  maxPostAgeMinutes: number,
): boolean {
  const dateStr = createdAtIsoOrSqlite.includes("T")
    ? createdAtIsoOrSqlite
    : createdAtIsoOrSqlite.replace(" ", "T") + "Z";
  const postTime = new Date(dateStr).getTime();
  if (isNaN(postTime)) return true;
  return Date.now() - postTime <= maxPostAgeMinutes * 60 * 1000;
}

/**
 * Checks search quota limit before firing search/scraping requests.
 */
export function validateSearchQuota(): GuardrailCheckResult {
  const rollingSearches = getRolling24hSearchCount();
  if (rollingSearches >= PLATFORM_LIMITS.SEARCHES_PER_24H) {
    return {
      allowed: false,
      code: "SEARCH_QUOTA",
      reason: `Search quota reached (${rollingSearches}/${PLATFORM_LIMITS.SEARCHES_PER_24H} in 24h)`,
    };
  }
  return { allowed: true };
}
