import { env } from "./config/env.js";
import express, { Request, Response } from "express";
import { fileURLToPath } from "node:url";
import { reviewRouter } from "./services/review.js";
import { productsRouter } from "./services/products-router.js";
import { campaigns, getCampaigns } from "./config/campaigns.js";
import {
  getDashboardData,
  getQueuedCount,
  getRolling24hSearchCount,
} from "./db.js";
import { runSourcingProducerCycle } from "./workers/producer.js";
import { getPostSourceProvider } from "./providers/factory.js";

const app = express();
const PORT = env.PORT;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let isProducerRunning = false;

/**
 * Health check endpoint
 */
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    activeCampaigns: getCampaigns().filter((c) => c.enabled).length,
    pendingPosts: getQueuedCount(),
  });
});

/**
 * Status endpoint
 */
app.get("/status", async (_req: Request, res: Response) => {
  const data = getDashboardData();
  const searchLimit = 2200;
  const usedSearches = getRolling24hSearchCount();
  const availableSearches = Math.max(0, searchLimit - usedSearches);

  res.json({
    status: "active",
    isProducerRunning,
    sourceProvider: getPostSourceProvider().name,
    searches: {
      used: usedSearches,
      limit: searchLimit,
      available: availableSearches,
      window: "Rolling 24h",
    },
    campaigns: getCampaigns().map((c) => ({
      id: c.id,
      name: c.productName,
      enabled: c.enabled,
      keywordsCount: c.keywords.length,
      pendingPosts: getQueuedCount(c.id),
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
      `[Manual Trigger] Sourcing posts for review (campaign: ${campaignId || "all"})...`
    );
    const results = await runSourcingProducerCycle(campaignId);
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

// Review & Human-in-the-Loop Web Intent API
app.use("/api/review", reviewRouter);

// Products & Keywords Management API
app.use("/api/products", productsRouter);

// Static frontend dashboard
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

app.listen(PORT, () => {
  console.log(
    `\n🚀 Threads AI Social Reply Bot (Human-in-the-Loop) running at http://localhost:${PORT}`
  );
  console.log(`📡 Scraper Provider: "${getPostSourceProvider().name}"`);
  console.log(
    `🎯 Configured products: ${getCampaigns()
      .map((c) => (c.enabled ? c.productName : `${c.productName} (paused)`))
      .join(", ")}`
  );
  console.log(`📋 Human-in-the-loop dashboard: http://localhost:${PORT}\n`);
});
