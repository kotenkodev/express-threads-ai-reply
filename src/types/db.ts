export type PostStatus =
  | "PENDING"
  | "REPLIED"
  | "IGNORED"
  | "QUEUED"
  | "SENDING"
  | "SKIPPED"
  | "REJECTED"
  | "FAILED"
  | "EXPIRED"
  | "DRY_RUN";

export interface ProcessedPostRecord {
  post_id: string; // externalId
  shortcode?: string | null;
  campaign_id: string;
  username: string; // author
  post_text: string; // content
  permalink?: string | null; // url
  ai_score?: number | null; // relevanceScore
  relevanceScore?: number | null;
  ai_reasoning?: string | null;
  reply_text?: string | null; // aiDraftReply
  aiDraftReply?: string | null;
  reply_id?: string | null;
  intent_url?: string | null;
  status: PostStatus;
  created_at: string; // postedAt
}

export type NewProcessedPostRecord = Omit<ProcessedPostRecord, "created_at"> & {
  created_at?: string;
};

export interface DashboardStats {
  total_processed: number;
  pending_count: number;
  queued_count: number;
  replied_count: number;
  ignored_count: number;
  skipped_count: number;
  expired_count: number;
  dry_run_count: number;
  failed_count: number;
}

export interface SearchLogRecord {
  id: number;
  campaign_id: string;
  keyword: string;
  posts_found: number;
  created_at: string;
}

export interface DashboardData {
  today: DashboardStats;
  recentPosts: ProcessedPostRecord[];
}
