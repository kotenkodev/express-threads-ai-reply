import type {
  PostStatus,
  ProcessedPostRecord,
  NewProcessedPostRecord,
  SearchLogRecord,
  DashboardData,
  DashboardStats,
} from "../types/db.js";
import type { DatabaseRepository } from "./repository.js";

function parseDateMs(dateStr: string): number {
  const normalized = dateStr.includes("T")
    ? dateStr
    : dateStr.replace(" ", "T") + (dateStr.endsWith("Z") ? "" : "Z");
  const time = new Date(normalized).getTime();
  return isNaN(time) ? Date.now() : time;
}

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getUTCFullYear() === date2.getUTCFullYear() &&
    date1.getUTCMonth() === date2.getUTCMonth() &&
    date1.getUTCDate() === date2.getUTCDate()
  );
}

export class InMemoryDatabaseRepository implements DatabaseRepository {
  readonly name = "in_memory";

  private posts = new Map<string, ProcessedPostRecord>();
  private searchLogs: SearchLogRecord[] = [];
  private searchLogIdSequence = 1;

  getPost(postId: string): ProcessedPostRecord | undefined {
    const post = this.posts.get(postId);
    return post ? { ...post } : undefined;
  }

  getMatchedPosts(campaignId?: string): ProcessedPostRecord[] {
    const items = Array.from(this.posts.values()).filter(
      (p) => p.status === "QUEUED" && (!campaignId || p.campaign_id === campaignId)
    );
    items.sort((a, b) => parseDateMs(b.created_at) - parseDateMs(a.created_at));
    return items.map((p) => ({ ...p }));
  }

  editQueuedPost(postId: string, replyText: string): boolean {
    const post = this.posts.get(postId);
    if (!post || post.status !== "QUEUED") {
      return false;
    }
    post.reply_text = replyText;
    return true;
  }

  claimQueuedPost(postId: string): boolean {
    const post = this.posts.get(postId);
    if (!post || post.status !== "QUEUED") {
      return false;
    }
    post.status = "SENDING";
    return true;
  }

  recordSearchLog(campaignId: string, keyword: string, postsFound: number = 0): void {
    this.searchLogs.push({
      id: this.searchLogIdSequence++,
      campaign_id: campaignId,
      keyword,
      posts_found: postsFound,
      created_at: new Date().toISOString(),
    });
  }

  getRolling24hSearchCount(): number {
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    return this.searchLogs.filter((log) => parseDateMs(log.created_at) >= cutoffMs).length;
  }

  isPostProcessed(postId: string): boolean {
    return this.posts.has(postId);
  }

  hasRepliedToUserRecently(campaignId: string, username: string, days: number = 7): boolean {
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const author = username.toLowerCase();
    const relevantStatuses: PostStatus[] = ["REPLIED", "QUEUED", "SENDING", "DRY_RUN"];

    for (const post of this.posts.values()) {
      if (
        post.campaign_id === campaignId &&
        post.username.toLowerCase() === author &&
        relevantStatuses.includes(post.status) &&
        parseDateMs(post.created_at) >= cutoffMs
      ) {
        return true;
      }
    }
    return false;
  }

  getDailyReplyCount(campaignId: string): number {
    const now = new Date();
    let count = 0;
    for (const post of this.posts.values()) {
      if (
        post.campaign_id === campaignId &&
        (post.status === "REPLIED" || post.status === "DRY_RUN")
      ) {
        const postDate = new Date(parseDateMs(post.created_at));
        if (isSameDay(now, postDate)) {
          count++;
        }
      }
    }
    return count;
  }

  getNextQueuedPost(campaignId: string): ProcessedPostRecord | undefined {
    const queued = Array.from(this.posts.values())
      .filter((p) => p.campaign_id === campaignId && p.status === "QUEUED")
      .sort((a, b) => parseDateMs(a.created_at) - parseDateMs(b.created_at));

    const post = queued[0];
    return post ? { ...post } : undefined;
  }

  getQueuedCount(campaignId?: string): number {
    let count = 0;
    for (const post of this.posts.values()) {
      if (post.status === "QUEUED" && (!campaignId || post.campaign_id === campaignId)) {
        count++;
      }
    }
    return count;
  }

  updatePostStatus(
    postId: string,
    status: PostStatus,
    extra?: { reply_id?: string; ai_reasoning?: string }
  ): void {
    const post = this.posts.get(postId);
    if (!post) return;

    post.status = status;
    if (extra?.reply_id !== undefined) {
      post.reply_id = extra.reply_id;
    }
    if (extra?.ai_reasoning !== undefined) {
      post.ai_reasoning = extra.ai_reasoning;
    }
  }

  saveProcessedPost(record: NewProcessedPostRecord): void {
    const existing = this.posts.get(record.post_id);
    if (existing) {
      // Upsert update
      if (record.ai_score !== undefined) existing.ai_score = record.ai_score;
      if (record.ai_reasoning !== undefined) existing.ai_reasoning = record.ai_reasoning;
      if (record.reply_text !== undefined) existing.reply_text = record.reply_text;
      if (record.reply_id !== undefined) existing.reply_id = record.reply_id;
      existing.status = record.status;
      if (record.created_at) existing.created_at = record.created_at;
      return;
    }

    // New insertion
    const created_at = record.created_at ?? new Date().toISOString();
    this.posts.set(record.post_id, {
      post_id: record.post_id,
      campaign_id: record.campaign_id,
      username: record.username,
      post_text: record.post_text,
      permalink: record.permalink ?? null,
      ai_score: record.ai_score ?? null,
      ai_reasoning: record.ai_reasoning ?? null,
      reply_text: record.reply_text ?? null,
      reply_id: record.reply_id ?? null,
      status: record.status,
      created_at,
    });
  }

  getDashboardData(): DashboardData {
    const now = new Date();
    const stats: DashboardStats = {
      total_processed: 0,
      queued_count: 0,
      replied_count: 0,
      dry_run_count: 0,
      skipped_count: 0,
      expired_count: 0,
      failed_count: 0,
    };

    for (const post of this.posts.values()) {
      const postDate = new Date(parseDateMs(post.created_at));
      if (isSameDay(now, postDate)) {
        stats.total_processed++;
        if (post.status === "QUEUED") stats.queued_count++;
        else if (post.status === "REPLIED") stats.replied_count++;
        else if (post.status === "DRY_RUN") stats.dry_run_count++;
        else if (post.status === "SKIPPED") stats.skipped_count++;
        else if (post.status === "EXPIRED") stats.expired_count++;
        else if (post.status === "FAILED") stats.failed_count++;
      }
    }

    const recentPosts = Array.from(this.posts.values())
      .sort((a, b) => parseDateMs(b.created_at) - parseDateMs(a.created_at))
      .slice(0, 50)
      .map((p) => ({ ...p }));

    return {
      today: stats,
      recentPosts,
    };
  }

  deletePost(postId: string): boolean {
    return this.posts.delete(postId);
  }

  clear(): void {
    this.posts.clear();
    this.searchLogs = [];
    this.searchLogIdSequence = 1;
  }
}

