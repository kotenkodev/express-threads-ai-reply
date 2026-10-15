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
