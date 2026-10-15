import type {
  PostStatus,
  ProcessedPostRecord,
  NewProcessedPostRecord,
  SearchLogRecord,
  DashboardData,
  DashboardStats,
} from "../types/db.js";
import type { DatabaseRepository } from "./repository.js";
import { buildThreadsReplyIntentUrl } from "../utils/intent.js";

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

function extractShortcode(permalink?: string | null, rawShortcode?: string | null): string | undefined {
  if (rawShortcode && rawShortcode.trim().length > 0) {
    return rawShortcode.trim();
  }
  if (!permalink) return undefined;
  const match = permalink.match(/\/post\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : undefined;
}

export class InMemoryDatabaseRepository implements DatabaseRepository {
  readonly name = "in_memory";

  private posts = new Map<string, ProcessedPostRecord>();
  private searchLogs: SearchLogRecord[] = [];
  private searchLogIdSequence = 1;

  private decorateRecord(row: ProcessedPostRecord): ProcessedPostRecord {
    const shortcode = row.shortcode || extractShortcode(row.permalink);
    const replyText = row.reply_text || row.aiDraftReply;
    const intentUrl =
      row.intent_url ||
      (replyText && (shortcode || row.permalink)
        ? buildThreadsReplyIntentUrl(shortcode || row.permalink!, replyText)
        : null);

    return {
      ...row,
      shortcode: shortcode ?? null,
      intent_url: intentUrl,
      relevanceScore: row.ai_score,
      aiDraftReply: row.reply_text,
    };
  }

  getPost(postId: string): ProcessedPostRecord | undefined {
    const post = this.posts.get(postId);
    return post ? this.decorateRecord({ ...post }) : undefined;
  }

  getPostByShortcode(shortcode: string): ProcessedPostRecord | undefined {
    for (const post of this.posts.values()) {
      if (post.shortcode === shortcode || extractShortcode(post.permalink) === shortcode) {
        return this.decorateRecord({ ...post });
      }
    }
    return undefined;
  }

  getMatchedPosts(campaignId?: string): ProcessedPostRecord[] {
    return this.getPendingPosts(campaignId);
  }

  getPendingPosts(campaignId?: string): ProcessedPostRecord[] {
    const items = Array.from(this.posts.values()).filter(
      (p) =>
        (p.status === "PENDING" || p.status === "QUEUED") &&
        (!campaignId || p.campaign_id === campaignId)
    );
    items.sort((a, b) => parseDateMs(b.created_at) - parseDateMs(a.created_at));
    return items.map((p) => this.decorateRecord({ ...p }));
  }

  editQueuedPost(postId: string, replyText: string): boolean {
    return this.updatePostDraft(postId, replyText);
  }

  updatePostDraft(postId: string, replyText: string): boolean {
    const post = this.posts.get(postId);
    if (!post || (post.status !== "PENDING" && post.status !== "QUEUED")) {
      return false;
    }
    post.reply_text = replyText;
    const shortcode = post.shortcode || extractShortcode(post.permalink) || postId;
    post.intent_url = buildThreadsReplyIntentUrl(shortcode, replyText);
    return true;
  }

  markPostReplied(postId: string, replyId?: string): boolean {
    const post = this.posts.get(postId);
    if (!post) return false;
    post.status = "REPLIED";
    if (replyId) post.reply_id = replyId;
    return true;
  }

  markPostIgnored(postId: string): boolean {
    const post = this.posts.get(postId);
    if (!post) return false;
    post.status = "IGNORED";
    return true;
  }

  claimQueuedPost(postId: string): boolean {
    const post = this.posts.get(postId);
    if (!post || (post.status !== "PENDING" && post.status !== "QUEUED")) {
      return false;
    }
    post.status = "SENDING" as PostStatus;
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

  isPostProcessed(postId: string, shortcode?: string): boolean {
    if (this.posts.has(postId)) return true;
    if (shortcode) {
      for (const post of this.posts.values()) {
        if (post.shortcode === shortcode || extractShortcode(post.permalink) === shortcode) {
          return true;
        }
      }
    }
    return false;
  }

  hasRepliedToUserRecently(campaignId: string, username: string, days: number = 7): boolean {
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const author = username.toLowerCase();
    const relevantStatuses: PostStatus[] = ["REPLIED", "QUEUED", "PENDING", "SENDING", "DRY_RUN"];

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
      .filter((p) => p.campaign_id === campaignId && (p.status === "PENDING" || p.status === "QUEUED"))
      .sort((a, b) => parseDateMs(a.created_at) - parseDateMs(b.created_at));

    const post = queued[0];
    return post ? this.decorateRecord({ ...post }) : undefined;
  }

  getQueuedCount(campaignId?: string): number {
    let count = 0;
    for (const post of this.posts.values()) {
      if (
        (post.status === "PENDING" || post.status === "QUEUED") &&
        (!campaignId || post.campaign_id === campaignId)
      ) {
        count++;
      }
    }
    return count;
  }

  getPendingCount(campaignId?: string): number {
    return this.getQueuedCount(campaignId);
  }

  updatePostStatus(
    postId: string,
    status: PostStatus,
    extra?: { reply_id?: string; ai_reasoning?: string; intent_url?: string }
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
    if (extra?.intent_url !== undefined) {
      post.intent_url = extra.intent_url;
    }
  }

  saveProcessedPost(record: NewProcessedPostRecord): void {
    const shortcode = record.shortcode || extractShortcode(record.permalink);
    const replyText = record.reply_text || record.aiDraftReply || null;
    const aiScore = record.ai_score ?? record.relevanceScore ?? null;

    let intentUrl = record.intent_url ?? null;
    if (!intentUrl && replyText && (shortcode || record.permalink)) {
      intentUrl = buildThreadsReplyIntentUrl(shortcode || record.permalink!, replyText);
    }

    const existing = this.posts.get(record.post_id);
    if (existing) {
      // Upsert update
      if (shortcode) existing.shortcode = shortcode;
      if (aiScore !== undefined) existing.ai_score = aiScore;
      if (record.ai_reasoning !== undefined) existing.ai_reasoning = record.ai_reasoning;
      if (replyText !== undefined) existing.reply_text = replyText;
      if (record.reply_id !== undefined) existing.reply_id = record.reply_id;
      if (intentUrl !== undefined) existing.intent_url = intentUrl;
      existing.status = record.status;
      if (record.created_at) existing.created_at = record.created_at;
      return;
    }

    // New insertion
    const created_at = record.created_at ?? new Date().toISOString();
    this.posts.set(record.post_id, {
      post_id: record.post_id,
      shortcode: shortcode ?? null,
      campaign_id: record.campaign_id,
      username: record.username,
      post_text: record.post_text,
      permalink: record.permalink ?? null,
      ai_score: aiScore,
      ai_reasoning: record.ai_reasoning ?? null,
      reply_text: replyText,
      reply_id: record.reply_id ?? null,
      intent_url: intentUrl,
      status: record.status,
      created_at,
    });
  }

  getDashboardData(): DashboardData {
    const now = new Date();
    const stats: DashboardStats = {
      total_processed: 0,
      pending_count: 0,
      queued_count: 0,
      replied_count: 0,
      ignored_count: 0,
      skipped_count: 0,
      expired_count: 0,
      dry_run_count: 0,
      failed_count: 0,
    };

    for (const post of this.posts.values()) {
      const postDate = new Date(parseDateMs(post.created_at));
      if (isSameDay(now, postDate)) {
        stats.total_processed++;
        if (post.status === "PENDING" || post.status === "QUEUED") {
          stats.pending_count++;
          if (post.status === "QUEUED") stats.queued_count++;
        } else if (post.status === "REPLIED") stats.replied_count++;
        else if (post.status === "IGNORED" || post.status === "REJECTED") {
          stats.ignored_count++;
          stats.skipped_count++;
        } else if (post.status === "DRY_RUN") stats.dry_run_count++;
        else if (post.status === "SKIPPED") stats.skipped_count++;
        else if (post.status === "EXPIRED") stats.expired_count++;
        else if (post.status === "FAILED") stats.failed_count++;
      }
    }

    const recentPosts = Array.from(this.posts.values())
      .sort((a, b) => parseDateMs(b.created_at) - parseDateMs(a.created_at))
      .slice(0, 50)
      .map((p) => this.decorateRecord({ ...p }));

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
