export type PostStatus =
  | "SKIPPED"
  | "QUEUED"
  | "SENDING"
  | "REJECTED"
  | "REPLIED"
  | "FAILED"
  | "EXPIRED"
  | "DRY_RUN";

export interface ProcessedPostRecord {
  post_id: string;
  campaign_id: string;
  username: string;
  post_text: string;
  permalink?: string | null;
  ai_score?: number | null;
  ai_reasoning?: string | null;
  reply_text?: string | null;
  reply_id?: string | null;
  status: PostStatus;
  created_at: string;
}

export type NewProcessedPostRecord = Omit<ProcessedPostRecord, "created_at"> & {
  created_at?: string;
};

export interface DashboardStats {
  total_processed: number;
  queued_count: number;
  replied_count: number;
  dry_run_count: number;
  skipped_count: number;
  expired_count: number;
  failed_count: number;
}

export interface SearchLogRecord {
  id: number;
  campaign_id: string;
  keyword: string;
  posts_found: number;
  created_at: string;
}

export interface QuotaSummary {
  searches: {
    used: number;
    limit: number;
    available: number;
    percentUsed: number;
    window: string;
  };
  replies: {
    metaUsed: number;
    metaLimit: number;
    metaAvailable: number;
    metaPercentUsed: number;
    campaignDailyUsed: number;
    campaignDailyLimit: number;
    campaignDailyAvailable: number;
  };
}

export interface DashboardData {
  today: DashboardStats;
  recentPosts: ProcessedPostRecord[];
  quota?: QuotaSummary;
}
