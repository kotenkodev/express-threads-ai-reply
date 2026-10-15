import { env, readCredential } from "../config/env.js";
import type { CampaignConfig } from "../types/campaign.js";
import {
  getPost,
  claimQueuedPost,
  updatePostStatus,
  getDailyReplyCount,
  ProcessedPostRecord,
} from "../db.js";
import { getPostPublishProvider } from "../providers/factory.js";
import { replyPolicyError } from "../services/reply-policy.js";
import { isWithinActiveHours } from "../services/anti-ban.js";

export interface PostingResult {
  campaignId: string;
  processed: boolean;
  postId?: string;
  username?: string;
  status?:
    | "REPLIED"
    | "DRY_RUN"
    | "EXPIRED"
    | "FAILED"
    | "OFF_HOURS"
    | "DAILY_LIMIT"
    | "EMPTY_QUEUE";
  replyText?: string;
  replyId?: string;
  error?: string;
}

/**
 * Sends the specific post approved by a reviewer, checks active hours,
 * verifies post isn't older than maxPostAgeMinutes (marking EXPIRED if so),
 * and publishes (or logs in DRY_RUN).
 */
export async function runPostingConsumerTick(
  campaign: CampaignConfig,
  approvedPostId?: string,
  options?: { forceLive?: boolean }
): Promise<PostingResult> {
  // Automatic ticks never publish: a reviewer must select a specific post.
  if (!approvedPostId) {
    return { campaignId: campaign.id, processed: false, status: "EMPTY_QUEUE" };
  }
  const isDryRun = options?.forceLive ? false : env.DRY_RUN;

  // Check 1: Active hours
  const { activeHoursStart, activeHoursEnd } = campaign.account;
  if (
    !isWithinActiveHours(
      activeHoursStart,
      activeHoursEnd,
      campaign.account.timeZone
    )
  ) {
    return {
      campaignId: campaign.id,
      processed: false,
      status: "OFF_HOURS",
      error: `Outside active hours (${activeHoursStart}:00 - ${activeHoursEnd}:00)`,
    };
  }

  // Check 2: Daily Limit
  const dailyCount = getDailyReplyCount(campaign.id);
  if (dailyCount >= campaign.account.dailyReplyLimit) {
    return {
      campaignId: campaign.id,
      processed: false,
      status: "DAILY_LIMIT",
      error: `Daily reply limit reached (${dailyCount}/${campaign.account.dailyReplyLimit})`,
    };
  }

  // Only the explicitly approved post can be sent.
  const post: ProcessedPostRecord | undefined = getPost(approvedPostId);
  if (!post || post.campaign_id !== campaign.id || post.status !== "QUEUED") {
    return {
      campaignId: campaign.id,
      processed: false,
      status: "EMPTY_QUEUE",
    };
  }

  // Check 3: Verify post age
  const createdAtMs = new Date(
    post.created_at.includes("T")
      ? post.created_at
      : post.created_at.replace(" ", "T") + "Z"
  ).getTime();
  const maxAgeMs = campaign.maxPostAgeMinutes * 60 * 1000;
  if (!isNaN(createdAtMs) && Date.now() - createdAtMs > maxAgeMs) {
    console.log(
      `⏳ [Consumer Expired] Queued post ${post.post_id} is older than ${campaign.maxPostAgeMinutes}m. Marking EXPIRED.`
    );
    updatePostStatus(post.post_id, "EXPIRED", {
      ai_reasoning: `Expired in queue: post exceeded max age of ${campaign.maxPostAgeMinutes} min`,
    });
    return {
      campaignId: campaign.id,
      processed: true,
      postId: post.post_id,
      username: post.username,
      status: "EXPIRED",
    };
  }

  const policyError = replyPolicyError(post.reply_text, campaign);
  if (policyError) {
    return { campaignId: campaign.id, processed: false, error: policyError };
  }
  if (!claimQueuedPost(post.post_id)) {
    return {
      campaignId: campaign.id,
      processed: false,
      error: "Post is already being sent",
    };
  }

  // Handle DRY_RUN mode
  if (isDryRun) {
    console.log(
      `\n📢 [Consumer DRY_RUN] Would post reply to @${post.username} (${post.permalink || post.post_id}):\n"${post.reply_text}"\n`
    );
    updatePostStatus(post.post_id, "DRY_RUN");
    return {
      campaignId: campaign.id,
      processed: true,
      postId: post.post_id,
      username: post.username,
      status: "DRY_RUN",
      replyText: post.reply_text || undefined,
    };
  }

  // LIVE posting via swappable publisher
  const tokenEnvVar = campaign.account.accessTokenEnvVar;
  const accessToken = readCredential(tokenEnvVar);
  if (!accessToken) {
    updatePostStatus(post.post_id, "FAILED", {
      ai_reasoning: `Missing token in env var ${tokenEnvVar}`,
    });
    return {
      campaignId: campaign.id,
      processed: true,
      postId: post.post_id,
      username: post.username,
      status: "FAILED",
      error: `Missing token in ${tokenEnvVar}`,
    };
  }

  try {
    const publisher = getPostPublishProvider(false);
    console.log(
      `🚀 [Consumer Publishing] Publishing reply for post ${post.post_id} via ${publisher.name}...`
    );

    const result = await publisher.publishReply({
      targetPostId: post.post_id,
      replyText: post.reply_text || "",
      campaign,
    });

    console.log(
      `✅ [Consumer Published] Reply posted! Reply ID: ${result.replyId}`
    );
    updatePostStatus(post.post_id, "REPLIED", { reply_id: result.replyId });

    return {
      campaignId: campaign.id,
      processed: true,
      postId: post.post_id,
      username: post.username,
      status: "REPLIED",
      replyText: post.reply_text || undefined,
      replyId: result.replyId,
    };
  } catch (publishErr) {
    const errorMsg = (publishErr as Error).message;
    console.error(
      `❌ [Consumer Publish Error] Failed publishing for post ${post.post_id}:`,
      errorMsg
    );
    updatePostStatus(post.post_id, "FAILED", { ai_reasoning: errorMsg });

    return {
      campaignId: campaign.id,
      processed: true,
      postId: post.post_id,
      username: post.username,
      status: "FAILED",
      error: errorMsg,
    };
  }
}

/** Source matches for review; never publish from a search trigger */
export async function runManualCycle(targetCampaignId?: string) {
  const { runSourcingProducerCycle } = await import("./producer.js");
  return {
    sourcing: await runSourcingProducerCycle(targetCampaignId),
    posting: [],
  };
}

