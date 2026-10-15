import type { CampaignConfig } from "../types/campaign.js";
import {
  hasRepliedToUserRecently,
  getDailyReplyCount,
  getRolling24hSearchCount,
} from "../db.js";
import { replyPolicyError } from "./reply-policy.js";

export const THREADS_PLATFORM_LIMITS = {
  SEARCHES_PER_24H: 2200,
  REPLIES_PER_24H: 1000,
  RECOMMENDED_DAILY_REPLY_CAP: 25,
  CONTAINER_PROCESSING_WAIT_MS: 20000, // 15-30s recommended by Meta docs
  AUTHOR_COOLDOWN_DAYS: 7,
};

export interface GuardrailCheckResult {
  allowed: boolean;
  reason?: string;
  code?: "OFF_HOURS" | "DAILY_LIMIT" | "SEARCH_QUOTA" | "COOLDOWN" | "EXPIRED" | "POLICY_VIOLATION";
}

/**
 * Checks if current time is within configured active hours in target timezone.
 * Prevents 24/7 bot behavior flags by Meta.
 */
export function isWithinActiveHours(
  startHour: number,
  endHour: number,
  timeZone?: string
): boolean {
  const currentHour = timeZone
    ? Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone,
          hour: "numeric",
          hourCycle: "h23",
        }).format(new Date())
      )
    : new Date().getHours();

  if (startHour <= endHour) {
    return currentHour >= startHour && currentHour < endHour;
  }
  // Handles overnight schedules if configured (e.g., 22 to 4)
  return currentHour >= startHour || currentHour < endHour;
}

/**
 * Verifies if post is recent enough to comment on.
 */
export function isPostFresh(createdAtIsoOrSqlite: string, maxPostAgeMinutes: number): boolean {
  const dateStr = createdAtIsoOrSqlite.includes("T")
    ? createdAtIsoOrSqlite
    : createdAtIsoOrSqlite.replace(" ", "T") + "Z";
  const postTime = new Date(dateStr).getTime();
  if (isNaN(postTime)) return true;
  return Date.now() - postTime <= maxPostAgeMinutes * 60 * 1000;
}

/**
 * Generates a randomized human jitter delay (in milliseconds).
 */
export function getHumanJitterMs(minSeconds: number = 180, maxSeconds: number = 600): number {
  const min = Math.max(0, minSeconds);
  const max = Math.max(min, maxSeconds);
  const randomSeconds = Math.floor(Math.random() * (max - min + 1)) + min;
  return randomSeconds * 1000;
}

/**
 * Checks search quota limit before firing search requests.
 */
export function validateSearchQuota(): GuardrailCheckResult {
  const rollingSearches = getRolling24hSearchCount();
  if (rollingSearches >= THREADS_PLATFORM_LIMITS.SEARCHES_PER_24H) {
    return {
      allowed: false,
      code: "SEARCH_QUOTA",
      reason: `Search quota reached (${rollingSearches}/${THREADS_PLATFORM_LIMITS.SEARCHES_PER_24H} in 24h)`,
    };
  }
  return { allowed: true };
}

