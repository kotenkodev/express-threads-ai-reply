import type { CampaignConfig } from "./campaign.js";

export interface PostSourceQuery {
  keyword: string;
  limit?: number;
  searchType?: "RECENT" | "TOP";
  campaign: CampaignConfig;
}

export interface PostSourceResult {
  id: string; // externalId
  shortcode?: string; // unique shortcode from /post/{shortcode}
  text: string; // content
  username: string; // author
  permalink: string; // url
  timestamp: string; // postedAt
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
