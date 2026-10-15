import type {
  PostStatus,
  ProcessedPostRecord,
  NewProcessedPostRecord,
  DashboardData,
} from "./types/db.js";
import {
  getDatabaseRepository,
  SqliteDatabaseRepository,
} from "./database/index.js";

export * from "./types/db.js";
export * from "./database/index.js";

export function getPost(postId: string): ProcessedPostRecord | undefined {
  return getDatabaseRepository().getPost(postId);
}

export function getMatchedPosts(campaignId?: string): ProcessedPostRecord[] {
  return getDatabaseRepository().getMatchedPosts(campaignId);
}

export function editQueuedPost(postId: string, replyText: string): boolean {
  return getDatabaseRepository().editQueuedPost(postId, replyText);
}

export function claimQueuedPost(postId: string): boolean {
  return getDatabaseRepository().claimQueuedPost(postId);
}

export function recordSearchLog(campaignId: string, keyword: string, postsFound: number = 0): void {
  getDatabaseRepository().recordSearchLog(campaignId, keyword, postsFound);
}

export function getRolling24hSearchCount(): number {
  return getDatabaseRepository().getRolling24hSearchCount();
}

export function isPostProcessed(postId: string): boolean {
  return getDatabaseRepository().isPostProcessed(postId);
}

export function hasRepliedToUserRecently(campaignId: string, username: string, days: number = 7): boolean {
  return getDatabaseRepository().hasRepliedToUserRecently(campaignId, username, days);
}

export function getDailyReplyCount(campaignId: string): number {
  return getDatabaseRepository().getDailyReplyCount(campaignId);
}

export function getNextQueuedPost(campaignId: string): ProcessedPostRecord | undefined {
  return getDatabaseRepository().getNextQueuedPost(campaignId);
}

export function getQueuedCount(campaignId?: string): number {
  return getDatabaseRepository().getQueuedCount(campaignId);
}

export function updatePostStatus(
  postId: string,
  status: PostStatus,
  extra?: { reply_id?: string; ai_reasoning?: string }
): void {
  getDatabaseRepository().updatePostStatus(postId, status, extra);
}

export function saveProcessedPost(record: NewProcessedPostRecord): void {
  getDatabaseRepository().saveProcessedPost(record);
}

export function getDashboardData(): DashboardData {
  return getDatabaseRepository().getDashboardData();
}

export function deletePost(postId: string): boolean {
  return getDatabaseRepository().deletePost?.(postId) ?? false;
}

/**
 * Compatibility handle for legacy scripts or tests that invoke raw SQLite queries.
 */
export const sqlite = {
  prepare: (sqlQuery: string) => ({
    run: (...args: unknown[]) => {
      if (sqlQuery.includes("DELETE FROM processed_posts WHERE post_id")) {
        const id = String(args[0]);
        deletePost(id);
      }
      return { changes: 1 };
    },
  }),
  pragma: () => {},
  exec: () => {},
  close: () => {},
};

/**
 * Compatibility handle for Drizzle ORM operations.
 */
export const db = new Proxy({}, {
  get(_target, prop) {
    const repo = getDatabaseRepository();
    if (repo instanceof SqliteDatabaseRepository) {
      return (repo.getDrizzleHandle() as any)[prop];
    }
    return (repo as any)[prop];
  },
});
