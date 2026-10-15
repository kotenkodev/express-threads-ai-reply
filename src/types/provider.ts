import type { CampaignConfig, CampaignAccountConfig } from "./campaign.js";

export interface PostSourceQuery {
  keyword: string;
  limit?: number;
  searchType?: "RECENT" | "TOP";
  campaign: CampaignConfig;
}

export interface PostSourceResult {
  id: string;
  text: string;
  username: string;
  permalink: string;
  timestamp: string; // ISO 8601 string
  isReply?: boolean;
  isQuotePost?: boolean;
  hasReplies?: boolean;
  mediaType?: string;
  raw?: unknown;
}

export interface PostSourceProvider {
  readonly name: string;
  searchPosts(query: PostSourceQuery): Promise<PostSourceResult[]>;
}

export interface PublishReplyParams {
  targetPostId: string;
  replyText: string;
  campaign: CampaignConfig;
  account?: CampaignAccountConfig;
}

export interface PublishReplyResult {
  replyId: string;
  status: "REPLIED" | "DRY_RUN" | "FAILED";
  containerId?: string;
}

export interface PostPublishProvider {
  readonly name: string;
  publishReply(params: PublishReplyParams): Promise<PublishReplyResult>;
  checkQuota?(account: CampaignAccountConfig): Promise<unknown>;
}

