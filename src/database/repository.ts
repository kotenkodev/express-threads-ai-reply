import type {
  PostStatus,
  ProcessedPostRecord,
  NewProcessedPostRecord,
  DashboardData,
} from "../types/db.js";

export interface DatabaseRepository {
  readonly name: string;

  getPost(postId: string): ProcessedPostRecord | undefined;
  getMatchedPosts(campaignId?: string): ProcessedPostRecord[];
  editQueuedPost(postId: string, replyText: string): boolean;
  claimQueuedPost(postId: string): boolean;
  recordSearchLog(campaignId: string, keyword: string, postsFound?: number): void;
  getRolling24hSearchCount(): number;
  isPostProcessed(postId: string): boolean;
  hasRepliedToUserRecently(campaignId: string, username: string, days?: number): boolean;
  getDailyReplyCount(campaignId: string): number;
  getNextQueuedPost(campaignId: string): ProcessedPostRecord | undefined;
  getQueuedCount(campaignId?: string): number;
  updatePostStatus(
    postId: string,
    status: PostStatus,
    extra?: { reply_id?: string; ai_reasoning?: string }
  ): void;
  saveProcessedPost(record: NewProcessedPostRecord): void;
  getDashboardData(): DashboardData;
  deletePost?(postId: string): boolean;
  clear?(): void;
}

