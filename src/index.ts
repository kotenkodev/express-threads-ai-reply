import { env, readCredential } from "./config/env.js";
import express, { Request, Response } from "express";
import cron from "node-cron";
import { fileURLToPath } from "node:url";
import { reviewRouter } from "./services/review.js";
import { campaigns } from "./config/campaigns.js";
import {
  getDashboardData,
  getQueuedCount,
  getRolling24hSearchCount,
} from "./db.js";
import { checkPublishingLimit } from "./providers/threads/client.js";
import type { QuotaSummary } from "./types/index.js";
import { runSourcingProducerCycle } from "./workers/producer.js";
import { runManualCycle } from "./workers/consumer.js";
import { authRouter, refreshThreadsAccessToken } from "./services/auth.js";

const app = express();
const PORT = env.PORT;
const isDryRun = env.DRY_RUN;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let isProducerRunning = false;

/**
 * Calculates current search and reply quota metrics across Meta API and local caps.
 */
async function getQuotaInfo(): Promise<QuotaSummary> {
  const campaign = campaigns.find((c) => c.enabled) || campaigns[0];
  const token =
    readCredential("THREADS_ACCESS_TOKEN_V") ||
    (campaign
      ? readCredential(campaign.account.accessTokenEnvVar)
      : undefined) ||
    readCredential("THREADS_ACCESS_TOKEN");

  // 1. Searches Quota (Meta official limit: 2,200 per rolling 24h)
  const searchLimit = 2200;
  const usedSearches = getRolling24hSearchCount();
  const availableSearches = Math.max(0, searchLimit - usedSearches);
  const searchPercent = Math.min(
    100,
    Math.round((usedSearches / searchLimit) * 100),
  );

  // 2. Meta Official Reply Quota (Meta official limit: 1,000 per 24h)
  let metaUsed = 0;
  let metaLimit = 1000;

  if (token) {
    try {
      const liveLimits = await checkPublishingLimit("me", token);
      if (liveLimits?.data?.[0]) {
        const item = liveLimits.data[0];
        if (typeof item.reply_quota_usage === "number") {
          metaUsed = item.reply_quota_usage;
        }
        if (item.reply_config?.quota_total) {
          metaLimit = item.reply_config.quota_total;
        }
      }
    } catch {
      // Graceful fallback if network or token check fails
    }
  }

  const metaAvailable = Math.max(0, metaLimit - metaUsed);
  const metaPercentUsed = Math.min(
    100,
    Math.round((metaUsed / metaLimit) * 100),
  );

  // 3. Campaign Safety Daily Cap (Configured per account to prevent bans)
  const dailyData = getDashboardData();
  const campaignDailyUsed =
    (dailyData.today.replied_count ?? 0) + (dailyData.today.dry_run_count ?? 0);
  const campaignDailyLimit = campaign?.account.dailyReplyLimit ?? 20;
  const campaignDailyAvailable = Math.max(
    0,
    campaignDailyLimit - campaignDailyUsed,
  );

  return {
    searches: {
      used: usedSearches,
      limit: searchLimit,
      available: availableSearches,
      percentUsed: searchPercent,
      window: "Rolling 24h",
    },
    replies: {
      metaUsed,
      metaLimit,
      metaAvailable,
      metaPercentUsed,
      campaignDailyUsed,
      campaignDailyLimit,
      campaignDailyAvailable,
    },
  };
}

/**
 * Health check endpoint
 */
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    dryRun: isDryRun,
    activeCampaigns: campaigns.filter((c) => c.enabled).length,
    queuedPosts: getQueuedCount(),
  });
});

/**
 * Status endpoint
 */
app.get("/status", async (_req: Request, res: Response) => {
  const data = getDashboardData();
  const quota = await getQuotaInfo();
  res.json({
    status: "active",
    isProducerRunning,
    dryRun: isDryRun,
    quota,
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.productName,
      enabled: c.enabled,
      keywordsCount: c.keywords.length,
      dailyReplyLimit: c.account.dailyReplyLimit,
      queuedPosts: getQueuedCount(c.id),
    })),
    stats: data.today,
  });
});

/**
 * Trigger manual execution
 */
async function triggerHandler(req: Request, res: Response) {
  if (isProducerRunning) {
    return res.status(429).json({
      error: "A sourcing cycle is already in progress. Please wait.",
    });
  }

  const campaignId =
    (req.query.campaignId as string | undefined) || req.body?.campaignId;

  try {
    isProducerRunning = true;
    console.log(
      `[Manual Trigger] Finding matches for review (campaign: ${campaignId || "all"})...`,
    );
    const results = await runManualCycle(campaignId);
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (err) {
    console.error("[Manual Trigger Error]:", err);
    return res.status(500).json({
      success: false,
      error: (err as Error).message,
    });
  } finally {
    isProducerRunning = false;
  }
}

app.post("/run-once", triggerHandler);
app.post("/trigger", triggerHandler);

app.use(authRouter);
app.use("/auth", authRouter);
app.use("/api/review", reviewRouter);
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

/**
 * Sourcing Producer Loop: Cron schedule (every 20-30 min or configured CRON_SCHEDULE)
 */
const cronPattern = env.CRON_SCHEDULE || "*/20 * * * *";
cron.schedule(cronPattern, async () => {
  if (isProducerRunning) {
    console.log(
      "[Scheduler] Skipping scheduled producer cycle because another cycle is active.",
    );
    return;
  }
  console.log(
    `[Scheduler] Triggering scheduled Sourcing Producer cycle (${cronPattern})...`,
  );
  try {
    isProducerRunning = true;
    await runSourcingProducerCycle();
  } catch (err) {
    console.error("[Scheduler Error]:", err);
  } finally {
    isProducerRunning = false;
  }
});

/**
 * Token Auto-Refresh Scheduler: Runs daily at 04:00 AM to keep 60-day Threads access tokens permanently refreshed.
 */
cron.schedule("0 4 * * *", async () => {
  try {
    console.log("[Scheduler] Running daily Threads token auto-refresh check...");
    await refreshThreadsAccessToken();
  } catch (err) {
    console.warn("[Scheduler] Token auto-refresh error:", (err as Error).message);
  }
});

app.listen(PORT, () => {
  // Check token on startup (if >24h old, auto-refreshes)
  refreshThreadsAccessToken().catch(() => {});
  console.log(
    `\n🚀 Threads AI Social Reply Bot running at http://localhost:${PORT}`,
  );
  console.log(
    `📊 Mode: ${isDryRun ? "DRY_RUN (safe mode, no publish)" : "LIVE (publishing enabled)"}`,
  );
  console.log(`⏰ Producer Cron: "${cronPattern}"`);
  console.log(
    `🎯 Active campaigns: ${campaigns
      .filter((c) => c.enabled)
      .map((c) => c.productName)
      .join(", ")}`,
  );

  console.log("[Review] Replies wait for manual approval in the dashboard.");
  console.log("");
});
