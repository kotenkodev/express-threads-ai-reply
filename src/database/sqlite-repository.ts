import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql, eq, and, inArray, gte, desc, asc, or } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import type {
  PostStatus,
  ProcessedPostRecord,
  NewProcessedPostRecord,
  DashboardData,
} from "../types/db.js";
import type { DatabaseRepository } from "./repository.js";
import { buildThreadsReplyIntentUrl } from "../utils/intent.js";

export const processedPosts = sqliteTable(
  "processed_posts",
  {
    post_id: text("post_id").primaryKey(),
    shortcode: text("shortcode"),
    campaign_id: text("campaign_id").notNull(),
    username: text("username").notNull(),
    post_text: text("post_text").notNull(),
    permalink: text("permalink"),
    ai_score: integer("ai_score"),
    ai_reasoning: text("ai_reasoning"),
    reply_text: text("reply_text"),
    reply_id: text("reply_id"),
    intent_url: text("intent_url"),
    status: text("status").$type<PostStatus>().notNull(),
    created_at: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  },
  (table) => [
    index("idx_campaign_username").on(table.campaign_id, table.username),
    index("idx_campaign_status_created").on(table.campaign_id, table.status, table.created_at),
    index("idx_shortcode").on(table.shortcode),
    index("idx_created_at").on(table.created_at),
  ]
);

export const searchLogs = sqliteTable(
  "search_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaign_id: text("campaign_id").notNull(),
    keyword: text("keyword").notNull(),
    posts_found: integer("posts_found").default(0).notNull(),
    created_at: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  },
  (table) => [
    index("idx_search_logs_created_at").on(table.created_at),
  ]
);

function extractShortcode(permalink?: string | null, rawShortcode?: string | null): string | undefined {
  if (rawShortcode && rawShortcode.trim().length > 0) {
    return rawShortcode.trim();
  }
  if (!permalink) return undefined;
  const match = permalink.match(/\/post\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : undefined;
}

export class SqliteDatabaseRepository implements DatabaseRepository {
  readonly name = "sqlite";
  private sqlite: Database.Database;
  private db: ReturnType<typeof drizzle>;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(path.resolve(process.cwd(), "data"), "bot.db");
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.sqlite = new Database(finalPath);
    this.sqlite.pragma("journal_mode = WAL");

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS processed_posts (
        post_id TEXT PRIMARY KEY,
        shortcode TEXT,
        campaign_id TEXT NOT NULL,
        username TEXT NOT NULL,
        post_text TEXT NOT NULL,
        permalink TEXT,
        ai_score INTEGER,
        ai_reasoning TEXT,
        reply_text TEXT,
        reply_id TEXT,
        intent_url TEXT,
        status TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_campaign_username ON processed_posts (campaign_id, username);
      CREATE INDEX IF NOT EXISTS idx_campaign_status_created ON processed_posts (campaign_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_shortcode ON processed_posts (shortcode);
      CREATE INDEX IF NOT EXISTS idx_created_at ON processed_posts (created_at);

      CREATE TABLE IF NOT EXISTS search_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL,
        keyword TEXT NOT NULL,
        posts_found INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_search_logs_created_at ON search_logs (created_at);
    `);

    // Safe column migrations for existing SQLite databases
    try {
      this.sqlite.exec("ALTER TABLE processed_posts ADD COLUMN shortcode TEXT;");
    } catch {
      // Column already exists
    }
    try {
      this.sqlite.exec("ALTER TABLE processed_posts ADD COLUMN intent_url TEXT;");
    } catch {
      // Column already exists
    }

    this.db = drizzle(this.sqlite, { schema: { processedPosts, searchLogs } });
  }

  getSqliteHandle(): Database.Database {
    return this.sqlite;
  }

  getDrizzleHandle() {
    return this.db;
  }

  private decorateRecord(row: any): ProcessedPostRecord {
    const shortcode = row.shortcode || extractShortcode(row.permalink);
    const replyText = row.reply_text || row.aiDraftReply;
    const intentUrl =
      row.intent_url ||
      (replyText && (shortcode || row.permalink)
        ? buildThreadsReplyIntentUrl(shortcode || row.permalink, replyText)
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
    const row = this.db.select().from(processedPosts).where(eq(processedPosts.post_id, postId)).get();
    return row ? this.decorateRecord(row) : undefined;
  }

  getPostByShortcode(shortcode: string): ProcessedPostRecord | undefined {
    const row = this.db.select().from(processedPosts).where(eq(processedPosts.shortcode, shortcode)).get();
    return row ? this.decorateRecord(row) : undefined;
  }

  getMatchedPosts(campaignId?: string): ProcessedPostRecord[] {
    return this.getPendingPosts(campaignId);
  }

  getPendingPosts(campaignId?: string): ProcessedPostRecord[] {
    const query = this.db.select().from(processedPosts);
    const statusCondition = inArray(processedPosts.status, ["PENDING", "QUEUED"] as PostStatus[]);
    let rows;

    if (campaignId) {
      rows = query
        .where(and(statusCondition, eq(processedPosts.campaign_id, campaignId)))
        .orderBy(desc(processedPosts.created_at))
        .all();
    } else {
      rows = query
        .where(statusCondition)
        .orderBy(desc(processedPosts.created_at))
        .all();
    }

    return rows.map((r) => this.decorateRecord(r));
  }

  editQueuedPost(postId: string, replyText: string): boolean {
    return this.updatePostDraft(postId, replyText);
  }

  updatePostDraft(postId: string, replyText: string): boolean {
    const existing = this.getPost(postId);
    if (!existing) return false;

    const shortcode = existing.shortcode || extractShortcode(existing.permalink) || postId;
    const intentUrl = buildThreadsReplyIntentUrl(shortcode, replyText);

    return (
      this.db
        .update(processedPosts)
        .set({
          reply_text: replyText,
          intent_url: intentUrl,
        })
        .where(
          and(
            eq(processedPosts.post_id, postId),
            inArray(processedPosts.status, ["PENDING", "QUEUED"] as PostStatus[])
          )
        )
        .run().changes === 1
    );
  }

  markPostReplied(postId: string, replyId?: string): boolean {
    return (
      this.db
        .update(processedPosts)
        .set({
          status: "REPLIED" as PostStatus,
          ...(replyId ? { reply_id: replyId } : {}),
        })
        .where(eq(processedPosts.post_id, postId))
        .run().changes === 1
    );
  }

  markPostIgnored(postId: string): boolean {
    return (
      this.db
        .update(processedPosts)
        .set({ status: "IGNORED" as PostStatus })
        .where(eq(processedPosts.post_id, postId))
        .run().changes === 1
    );
  }

  claimQueuedPost(postId: string): boolean {
    return (
      this.db
        .update(processedPosts)
        .set({ status: "SENDING" as PostStatus })
        .where(
          and(
            eq(processedPosts.post_id, postId),
            inArray(processedPosts.status, ["PENDING", "QUEUED"] as PostStatus[])
          )
        )
        .run().changes === 1
    );
  }

  recordSearchLog(campaignId: string, keyword: string, postsFound: number = 0): void {
    this.db
      .insert(searchLogs)
      .values({
        campaign_id: campaignId,
        keyword,
        posts_found: postsFound,
      })
      .run();
  }

  getRolling24hSearchCount(): number {
    const result = this.db
      .select({ count: sql<number>`count(*)` })
      .from(searchLogs)
      .where(gte(searchLogs.created_at, sql`datetime('now', '-24 hours')`))
      .get();
    return result?.count ?? 0;
  }

  isPostProcessed(postId: string, shortcode?: string): boolean {
    if (shortcode) {
      const row = this.db
        .select({ id: processedPosts.post_id })
        .from(processedPosts)
        .where(or(eq(processedPosts.post_id, postId), eq(processedPosts.shortcode, shortcode)))
        .get();
      return Boolean(row);
    }

    const row = this.db
      .select({ id: processedPosts.post_id })
      .from(processedPosts)
      .where(eq(processedPosts.post_id, postId))
      .get();
    return Boolean(row);
  }

  hasRepliedToUserRecently(campaignId: string, username: string, days: number = 7): boolean {
    const row = this.db
      .select({ id: processedPosts.post_id })
      .from(processedPosts)
      .where(
        and(
          eq(processedPosts.campaign_id, campaignId),
          eq(processedPosts.username, username),
          inArray(processedPosts.status, ["REPLIED", "QUEUED", "PENDING", "SENDING", "DRY_RUN"] as PostStatus[]),
          gte(processedPosts.created_at, sql`datetime('now', '-' || ${days} || ' days')`)
        )
      )
      .get();
    return Boolean(row);
  }

  getDailyReplyCount(campaignId: string): number {
    const result = this.db
      .select({ count: sql<number>`count(*)` })
      .from(processedPosts)
      .where(
        and(
          eq(processedPosts.campaign_id, campaignId),
          inArray(processedPosts.status, ["REPLIED", "DRY_RUN"] as PostStatus[]),
          sql`date(${processedPosts.created_at}) = date('now')`
        )
      )
      .get();
    return result?.count ?? 0;
  }

  getNextQueuedPost(campaignId: string): ProcessedPostRecord | undefined {
    const row = this.db
      .select()
      .from(processedPosts)
      .where(
        and(
          eq(processedPosts.campaign_id, campaignId),
          inArray(processedPosts.status, ["PENDING", "QUEUED"] as PostStatus[])
        )
      )
      .orderBy(asc(processedPosts.created_at))
      .limit(1)
      .get();
    return row ? this.decorateRecord(row) : undefined;
  }

  getQueuedCount(campaignId?: string): number {
    const conditions = [inArray(processedPosts.status, ["PENDING", "QUEUED"] as PostStatus[])];
    if (campaignId) {
      conditions.push(eq(processedPosts.campaign_id, campaignId));
    }
    const result = this.db
      .select({ count: sql<number>`count(*)` })
      .from(processedPosts)
      .where(and(...conditions))
      .get();
    return result?.count ?? 0;
  }

  getPendingCount(campaignId?: string): number {
    return this.getQueuedCount(campaignId);
  }

  updatePostStatus(
    postId: string,
    status: PostStatus,
    extra?: { reply_id?: string; ai_reasoning?: string; intent_url?: string }
  ): void {
    this.db
      .update(processedPosts)
      .set({
        status,
        ...(extra?.reply_id !== undefined ? { reply_id: extra.reply_id } : {}),
        ...(extra?.ai_reasoning !== undefined ? { ai_reasoning: extra.ai_reasoning } : {}),
        ...(extra?.intent_url !== undefined ? { intent_url: extra.intent_url } : {}),
      })
      .where(eq(processedPosts.post_id, postId))
      .run();
  }

  saveProcessedPost(record: NewProcessedPostRecord): void {
    const shortcode = record.shortcode || extractShortcode(record.permalink);
    const replyText = record.reply_text || record.aiDraftReply || null;
    const aiScore = record.ai_score ?? record.relevanceScore ?? null;

    let intentUrl = record.intent_url ?? null;
    if (!intentUrl && replyText && (shortcode || record.permalink)) {
      intentUrl = buildThreadsReplyIntentUrl(shortcode || record.permalink!, replyText);
    }

    this.db
      .insert(processedPosts)
      .values({
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
        created_at: record.created_at ?? sql`(datetime('now'))`,
      })
      .onConflictDoUpdate({
        target: processedPosts.post_id,
        set: {
          shortcode: shortcode ?? null,
          ai_score: aiScore,
          ai_reasoning: record.ai_reasoning ?? null,
          reply_text: replyText,
          reply_id: record.reply_id ?? null,
          intent_url: intentUrl,
          status: record.status,
        },
      })
      .run();
  }

  getDashboardData(): DashboardData {
    const statsResult = this.db
      .select({
        total_processed: sql<number>`count(*)`,
        pending_count: sql<number>`coalesce(sum(case when ${processedPosts.status} IN ('PENDING', 'QUEUED') then 1 else 0 end), 0)`,
        queued_count: sql<number>`coalesce(sum(case when ${processedPosts.status} = 'QUEUED' then 1 else 0 end), 0)`,
        replied_count: sql<number>`coalesce(sum(case when ${processedPosts.status} = 'REPLIED' then 1 else 0 end), 0)`,
        ignored_count: sql<number>`coalesce(sum(case when ${processedPosts.status} IN ('IGNORED', 'REJECTED') then 1 else 0 end), 0)`,
        dry_run_count: sql<number>`coalesce(sum(case when ${processedPosts.status} = 'DRY_RUN' then 1 else 0 end), 0)`,
        skipped_count: sql<number>`coalesce(sum(case when ${processedPosts.status} IN ('SKIPPED', 'IGNORED') then 1 else 0 end), 0)`,
        expired_count: sql<number>`coalesce(sum(case when ${processedPosts.status} = 'EXPIRED' then 1 else 0 end), 0)`,
        failed_count: sql<number>`coalesce(sum(case when ${processedPosts.status} = 'FAILED' then 1 else 0 end), 0)`,
      })
      .from(processedPosts)
      .where(sql`date(${processedPosts.created_at}) = date('now')`)
      .get();

    const recentPostsRaw = this.db
      .select()
      .from(processedPosts)
      .orderBy(desc(processedPosts.created_at))
      .limit(50)
      .all();

    const recentPosts = recentPostsRaw.map((r) => this.decorateRecord(r));

    return {
      today: (statsResult as any) ?? {
        total_processed: 0,
        pending_count: 0,
        queued_count: 0,
        replied_count: 0,
        ignored_count: 0,
        skipped_count: 0,
        expired_count: 0,
        dry_run_count: 0,
        failed_count: 0,
      },
      recentPosts,
    };
  }

  deletePost(postId: string): boolean {
    return this.sqlite.prepare("DELETE FROM processed_posts WHERE post_id = ?").run(postId).changes > 0;
  }
}
