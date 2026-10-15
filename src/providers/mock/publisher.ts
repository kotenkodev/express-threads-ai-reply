import type {
  PostPublishProvider,
  PublishReplyParams,
  PublishReplyResult,
} from "../../types/provider.js";
import type { CampaignAccountConfig } from "../../types/campaign.js";

export class MockPublisher implements PostPublishProvider {
  readonly name = "mock";

  async publishReply(params: PublishReplyParams): Promise<PublishReplyResult> {
    const { targetPostId, replyText } = params;
    const replyId = `mock_reply_${Date.now()}`;
    console.log(
      `[MockPublisher] Simulating publishing reply to post ${targetPostId}: "${replyText}" -> Generated mock replyId: ${replyId}`
    );
    return {
      replyId,
      status: "DRY_RUN",
    };
  }

  async checkQuota(_account: CampaignAccountConfig): Promise<unknown> {
    return {
      data: [
        {
          quota_usage: 5,
          config: { quota_total: 1000 },
          reply_quota_usage: 2,
          reply_config: { quota_total: 1000 },
        },
      ],
    };
  }
}

