export type ThreadsMediaType =
  | "TEXT_POST"
  | "IMAGE"
  | "VIDEO"
  | "CAROUSEL_ALBUM"
  | "REPOST_FACADE"
  | string;

export interface ThreadsPostOwner {
  id: string;
}

export interface ThreadsChildPost {
  id: string;
}

export interface ThreadsPostChildren {
  data: ThreadsChildPost[];
}

export interface ThreadsPost {
  id: string;
  media_product_type?: "THREADS" | string;
  media_type?: ThreadsMediaType;
  media_url?: string;
  permalink?: string;
  owner?: ThreadsPostOwner;
  username: string;
  text?: string;
  topic_tag?: string;
  timestamp: string;
  shortcode?: string;
  thumbnail_url?: string;
  children?: ThreadsPostChildren;
  is_quote_post?: boolean;
  has_replies?: boolean;
  is_reply?: boolean;
}

export interface ThreadsPagingCursors {
  before?: string;
  after?: string;
}

export interface ThreadsPaging {
  cursors?: ThreadsPagingCursors;
  next?: string;
  previous?: string;
}

export interface KeywordSearchResponse {
  data: ThreadsPost[];
  paging?: ThreadsPaging;
}

export interface CreateContainerResponse {
  id: string;
}

export interface PublishContainerResponse {
  id: string;
}

export interface PublishingLimitConfig {
  quota_total?: number;
  quota_duration?: number;
}

export interface PublishingLimitItem {
  quota_usage?: number;
  config?: PublishingLimitConfig;
  reply_quota_usage?: number;
  reply_config?: PublishingLimitConfig;
}

export interface PublishingLimitResponse {
  data: PublishingLimitItem[];
}
