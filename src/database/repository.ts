import type {
  PostStatus,
  ProcessedPostRecord,
  NewProcessedPostRecord,
  DashboardData,
} from "../types/db.js";

export interface DatabaseRepository {
  readonly name: string;

  getPost(postId: string): ProcessedPostRecord | undefined;
  getPostByShortcode?(shortcode: string): ProcessedPostRecord | undefined;
  getMatchedPosts(campaignId?: string): ProcessedPostRecord[];
  getPendingPosts?(campaignId?: string): ProcessedPostRecord[];
  editQueuedPost(postId: string, replyText: string): boolean;
  updatePostDraft?(postId: string, replyText: string): boolean;
  markPostReplied?(postId: string, replyId?: string): boolean;
  markPostIgnored?(postId: string): boolean;
  claimQueuedPost(postId: string): boolean;
  recordSearchLog(campaignId: string, keyword: string, postsFound?: number): void;
  getRolling24hSearchCount(): number;
  isPostProcessed(postId: string, shortcode?: string): boolean;
  hasRepliedToUserRecently(campaignId: string, username: string, days?: number): boolean;
  getDailyReplyCount(campaignId: string): number;
  getNextQueuedPost(campaignId: string): ProcessedPostRecord | undefined;
  getQueuedCount(campaignId?: string): number;
  getPendingCount?(campaignId?: string): number;
  updatePostStatus(
    postId: string,
    status: PostStatus,
    extra?: { reply_id?: string; ai_reasoning?: string; intent_url?: string }
  ): void;
  saveProcessedPost(record: NewProcessedPostRecord): void;
  getDashboardData(): DashboardData;
  deletePost?(postId: string): boolean;
  clear?(): void;
}
