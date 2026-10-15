import { campaigns, getCampaigns } from "../config/campaigns.js";
import {
  isPostProcessed,
  hasRepliedToUserRecently,
  saveProcessedPost,
  recordSearchLog,
  buildThreadsReplyIntentUrl,
} from "../db.js";
import { getPostSourceProvider } from "../providers/factory.js";
import { evaluatePostAndGenerateReply } from "../services/ai.js";
import { replyPolicyError, excludedPost } from "../services/reply-policy.js";
import {
  isPostFresh,
  validateSearchQuota,
  THREADS_PLATFORM_LIMITS,
} from "../services/anti-ban.js";

// Keep track of keyword rotation index per campaign in memory
const campaignKeywordIndices: Record<string, number> = {};

export interface SourcingResult {
  campaignId: string;
  keyword: string;
  provider: string;
  postsFound: number;
  evaluated: number;
  pending: number;
  queued: number; // backward-compatibility alias for pending
  skipped: number;
  ignored: number; // backward-compatibility alias for skipped
  duplicates: number;
}

function extractShortcode(permalink?: string | null): string | undefined {
  if (!permalink) return undefined;
  const match = permalink.match(/\/post\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : undefined;
}

/**
 * Sourcing Producer Loop (HITL Web Intent Pipeline):
 * 1. Iterates active campaigns
 * 2. Rotates keywords
 * 3. Uses swappable PostSourceProvider (Apify Scraper / Custom Scraper / Mock)
 * 4. Filters out sub-thread replies, stale posts, cooldown authors, excluded keywords/handles
 * 5. Runs AI relevance qualification & native draft generation
 * 6. Generates 1-click Threads Web Intent URL
 * 7. Saves candidates in SQLite with status 'PENDING'
 */
export async function runSourcingProducerCycle(
  targetCampaignId?: string
): Promise<SourcingResult[]> {
  const activeCampaigns = getCampaigns().filter(
    (c) => c.enabled && (!targetCampaignId || c.id === targetCampaignId)
  );

  const results: SourcingResult[] = [];

  for (const campaign of activeCampaigns) {
    const summary: SourcingResult = {
      campaignId: campaign.id,
      keyword: "",
      provider: "",
      postsFound: 0,
      evaluated: 0,
      pending: 0,
      queued: 0,
      skipped: 0,
      ignored: 0,
      duplicates: 0,
    };

    console.log(
      `\n🔍 [Producer Sourcing] Starting for: ${campaign.productName} (${campaign.id})`
    );

    if (!campaign.keywords || campaign.keywords.length === 0) {
      console.warn(`[Producer Config] No keywords defined for campaign ${campaign.id}`);
      results.push(summary);
      continue;
    }

    // Check platform search quota
    const searchQuotaCheck = validateSearchQuota();
    if (!searchQuotaCheck.allowed) {
      console.warn(`[Producer Quota Warning] ${searchQuotaCheck.reason}. Skipping search cycle.`);
      results.push(summary);
      continue;
    }

    // Keyword rotation
    const currentIndex = campaignKeywordIndices[campaign.id] ?? 0;
    const keyword = campaign.keywords[currentIndex % campaign.keywords.length];
    campaignKeywordIndices[campaign.id] = (currentIndex + 1) % campaign.keywords.length;
    summary.keyword = keyword;

    // Resolve swappable provider (Scraper / Mock / Custom)
    const sourceProvider = getPostSourceProvider(campaign);
    summary.provider = sourceProvider.name;

    console.log(
      `[Producer Search] Provider: [${sourceProvider.name}] | Keyword: "${keyword}" (index ${currentIndex})`
    );

    let rawPosts;
    try {
      rawPosts = await sourceProvider.searchPosts({
        keyword,
        campaign,
        searchType: campaign.searchType || "RECENT",
        limit: campaign.inspectPerRun || 25,
      });
    } catch (err) {
      console.error(
        `[Producer Search Error] ${sourceProvider.name} failed for "${keyword}":`,
        (err as Error).message
      );
      results.push(summary);
      continue;
    }

    summary.postsFound = rawPosts.length;
    recordSearchLog(campaign.id, keyword, rawPosts.length);
    console.log(`[Producer Results] Found ${rawPosts.length} posts for "${keyword}"`);

    // Sourcing limits & candidate evaluation
    const maxToInspect = campaign.inspectPerRun || 25;
    const maxToDraft = campaign.draftsPerRun || 5;

    for (const post of rawPosts) {
      if (summary.evaluated >= maxToInspect || summary.pending >= maxToDraft) {
        break;
      }

      const shortcode = post.shortcode || extractShortcode(post.permalink);

      // Check 1: Deduplication by externalId (post.id) or shortcode
      if (isPostProcessed(post.id, shortcode)) {
        summary.duplicates += 1;
        continue;
      }

      // Check 2: Skip comments/sub-thread replies to focus on root discussions
      if (post.isReply) {
        console.log(`[Producer Deduplication] Post ${post.id} is a sub-reply. Skipping.`);
        saveProcessedPost({
          post_id: post.id,
          shortcode,
          campaign_id: campaign.id,
          username: post.username,
          post_text: post.text || "",
          permalink: post.permalink,
          status: "IGNORED",
          ai_reasoning: "Sub-thread comment (skipped root reply)",
        });
        summary.skipped += 1;
        summary.ignored += 1;
        continue;
      }

      // Check 3: Author cooldown (no multiple replies in last 7 days)
      if (
        hasRepliedToUserRecently(
          campaign.id,
          post.username,
          THREADS_PLATFORM_LIMITS.AUTHOR_COOLDOWN_DAYS
        )
      ) {
        console.log(
          `[Producer Deduplication] Already replied to @${post.username} recently. Skipping.`
        );
        saveProcessedPost({
          post_id: post.id,
          shortcode,
          campaign_id: campaign.id,
          username: post.username,
          post_text: post.text || "",
          permalink: post.permalink,
          status: "IGNORED",
          ai_reasoning: `Author cooldown: already replied to @${post.username} in last 7 days`,
        });
        summary.skipped += 1;
        summary.ignored += 1;
        continue;
      }

      // Check 4: Post freshness
      if (!isPostFresh(post.timestamp, campaign.maxPostAgeMinutes)) {
        console.log(
          `[Producer Deduplication] Post ${post.id} older than ${campaign.maxPostAgeMinutes}m. Skipping.`
        );
        saveProcessedPost({
          post_id: post.id,
          shortcode,
          campaign_id: campaign.id,
          username: post.username,
          post_text: post.text || "",
          permalink: post.permalink,
          status: "IGNORED",
          ai_reasoning: `Post is older than ${campaign.maxPostAgeMinutes} minutes`,
        });
        summary.skipped += 1;
        summary.ignored += 1;
        continue;
      }

      // Check 5: Excluded keywords / handles / own handle
      if (excludedPost(post.text, post.username, campaign)) {
        console.log(`[Producer Deduplication] Post matches exclusion rule. Skipping.`);
        saveProcessedPost({
          post_id: post.id,
          shortcode,
          campaign_id: campaign.id,
          username: post.username,
          post_text: post.text || "",
          permalink: post.permalink,
          status: "IGNORED",
          ai_reasoning: "Matched excluded keywords, handle, or own handle",
        });
        summary.skipped += 1;
        summary.ignored += 1;
        continue;
      }

      // AI Relevance Filter & Native Reply Draft Generation
      summary.evaluated += 1;
      console.log(
        `[Producer AI] Evaluating post from @${post.username}: "${(post.text || "").slice(0, 80)}..."`
      );

      try {
        const aiResult = await evaluatePostAndGenerateReply(
          post.text || "",
          post.username,
          campaign
        );

        if (
          !aiResult.isRelevant ||
          aiResult.confidenceScore < campaign.minConfidenceScore ||
          replyPolicyError(aiResult.replyText, campaign)
        ) {
          saveProcessedPost({
            post_id: post.id,
            shortcode,
            campaign_id: campaign.id,
            username: post.username,
            post_text: post.text || "",
            permalink: post.permalink,
            ai_score: aiResult.confidenceScore,
            relevanceScore: aiResult.confidenceScore,
            ai_reasoning: aiResult.reasoning,
            status: "IGNORED",
          });
          summary.skipped += 1;
          summary.ignored += 1;
        } else {
          const intentUrl = buildThreadsReplyIntentUrl(
            shortcode || post.permalink,
            aiResult.replyText
          );

          saveProcessedPost({
            post_id: post.id,
            shortcode,
            campaign_id: campaign.id,
            username: post.username,
            post_text: post.text || "",
            permalink: post.permalink,
            ai_score: aiResult.confidenceScore,
            relevanceScore: aiResult.confidenceScore,
            ai_reasoning: aiResult.reasoning,
            reply_text: aiResult.replyText,
            aiDraftReply: aiResult.replyText,
            intent_url: intentUrl,
            status: "PENDING",
          });
          summary.pending += 1;
          summary.queued += 1; // sync alias
          console.log(
            `📥 [Producer Pending] Post ${post.id} (${shortcode || "no code"}) from @${post.username} (score: ${aiResult.confidenceScore}) drafted with Web Intent.`
          );
        }
      } catch (err) {
        console.error(
          `[Producer AI Error] Failed evaluating post ${post.id}:`,
          (err as Error).message
        );
        saveProcessedPost({
          post_id: post.id,
          shortcode,
          campaign_id: campaign.id,
          username: post.username,
          post_text: post.text || "",
          permalink: post.permalink,
          status: "FAILED",
          ai_reasoning: `AI evaluation error: ${(err as Error).message}`,
        });
      }
    }

    results.push(summary);
  }

  return results;
}
