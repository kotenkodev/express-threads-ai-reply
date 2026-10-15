import type {
  PostPublishProvider,
  PublishReplyParams,
  PublishReplyResult,
} from "../../types/provider.js";
import type { CampaignAccountConfig } from "../../types/campaign.js";
import { publishReplyWithWait, checkPublishingLimit } from "./client.js";
import { readCredential } from "../../config/env.js";
import { resolveThreadsMediaId } from "./resolver.js";
import { getPost } from "../../db.js";

export class MetaThreadsPublisher implements PostPublishProvider {
  readonly name = "threads_api";

  async publishReply(params: PublishReplyParams): Promise<PublishReplyResult> {
    let { targetPostId, replyText, campaign } = params;
    const account = params.account || campaign.account;
    const tokenEnvVar = account.accessTokenEnvVar;
    const accessToken = readCredential(tokenEnvVar);

    if (!accessToken) {
      throw new Error(`Missing required access token in env var: ${tokenEnvVar}`);
    }

    // Auto-resolve non-Graph API IDs (e.g. Apify scraped posts or shortcodes)
    if (!/^\d{16,18}$/.test(targetPostId)) {
      console.log(`[Publisher] Target ID "${targetPostId}" is not a Meta Graph API ID. Attempting resolution...`);
      const postRecord = getPost(targetPostId);
      const resolvedId = await resolveThreadsMediaId(
        {
          id: targetPostId,
          permalink: postRecord?.permalink || undefined,
          text: postRecord?.post_text || undefined,
          username: postRecord?.username || undefined,
        },
        accessToken
      );

      if (resolvedId) {
        console.log(`[Publisher] Successfully resolved "${targetPostId}" -> "${resolvedId}"`);
        targetPostId = resolvedId;
      } else {
        throw new Error(
          `Cannot publish live reply to "${targetPostId}": this post was found via web scraper, but Meta Threads API requires an official Graph API Media ID (17 digits, e.g. 18012979100985435).\n` +
          `In Meta Development Mode, you can only reply to posts authored by test accounts added to your Meta App.`
        );
      }
    }

    const replyId = await publishReplyWithWait(
      account.threadsUserId || "me",
      targetPostId,
      replyText,
      accessToken
    );

    return {
      replyId,
      status: "REPLIED",
    };
  }

  async checkQuota(account: CampaignAccountConfig): Promise<unknown> {
    const accessToken = readCredential(account.accessTokenEnvVar);
    if (!accessToken) return null;
    return checkPublishingLimit(account.threadsUserId || "me", accessToken);
  }
}

