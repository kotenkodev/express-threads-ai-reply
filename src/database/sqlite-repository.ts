import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql, eq, and, inArray, gte, desc, asc } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import type {
  PostStatus,
  ProcessedPostRecord,
  NewProcessedPostRecord,
  DashboardData,
} from "../types/db.js";
import type { DatabaseRepository } from "./repository.js";

export const processedPosts = sqliteTable(
  "processed_posts",
  {
    post_id: text("post_id").primaryKey(),
    campaign_id: text("campaign_id").notNull(),
    username: text("username").notNull(),
    post_text: text("post_text").notNull(),
    permalink: text("permalink"),
    ai_score: integer("ai_score"),
    ai_reasoning: text("ai_reasoning"),
    reply_text: text("reply_text"),
    reply_id: text("reply_id"),
    status: text("status").$type<PostStatus>().notNull(),
    created_at: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  },
  (table) => [
    index("idx_campaign_username").on(table.campaign_id, table.username),
    index("idx_campaign_status_created").on(table.campaign_id, table.status, table.created_at),
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
        campaign_id TEXT NOT NULL,
        username TEXT NOT NULL,
        post_text TEXT NOT NULL,
        permalink TEXT,
        ai_score INTEGER,
        ai_reasoning TEXT,
        reply_text TEXT,
        reply_id TEXT,
        status TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_campaign_username ON processed_posts (campaign_id, username);
      CREATE INDEX IF NOT EXISTS idx_campaign_status_created ON processed_posts (campaign_id, status, created_at);
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

    this.db = drizzle(this.sqlite, { schema: { processedPosts, searchLogs } });
  }

  getSqliteHandle(): Database.Database {
    return this.sqlite;
  }

  getDrizzleHandle() {
    return this.db;
  }

  getPost(postId: string): ProcessedPostRecord | undefined {
    return this.db.select().from(processedPosts).where(eq(processedPosts.post_id, postId)).get();
  }

  getMatchedPosts(campaignId?: string): ProcessedPostRecord[] {
    const query = this.db.select().from(processedPosts);
    if (campaignId) {
      return query
        .where(and(eq(processedPosts.status, "QUEUED"), eq(processedPosts.campaign_id, campaignId)))
        .orderBy(desc(processedPosts.created_at))
        .all();
    }
    return query
      .where(eq(processedPosts.status, "QUEUED"))
      .orderBy(desc(processedPosts.created_at))
      .all();
  }

  editQueuedPost(postId: string, replyText: string): boolean {
    return (
      this.db
        .update(processedPosts)
        .set({ reply_text: replyText })
        .where(and(eq(processedPosts.post_id, postId), eq(processedPosts.status, "QUEUED")))
        .run().changes === 1
    );
  }

  claimQueuedPost(postId: string): boolean {
    return (
      this.db
        .update(processedPosts)
        .set({ status: "SENDING" })
        .where(and(eq(processedPosts.post_id, postId), eq(processedPosts.status, "QUEUED")))
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

  isPostProcessed(postId: string): boolean {
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
          inArray(processedPosts.status, ["REPLIED", "QUEUED", "SENDING", "DRY_RUN"]),
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
          inArray(processedPosts.status, ["REPLIED", "DRY_RUN"]),
          sql`date(${processedPosts.created_at}) = date('now')`
        )
      )
      .get();
    return result?.count ?? 0;
  }

  getNextQueuedPost(campaignId: string): ProcessedPostRecord | undefined {
    return this.db
      .select()
      .from(processedPosts)
      .where(and(eq(processedPosts.campaign_id, campaignId), eq(processedPosts.status, "QUEUED")))
      .orderBy(asc(processedPosts.created_at))
      .limit(1)
      .get() as ProcessedPostRecord | undefined;
  }

  getQueuedCount(campaignId?: string): number {
    const conditions = [eq(processedPosts.status, "QUEUED")];
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

  updatePostStatus(
    postId: string,
    status: PostStatus,
    extra?: { reply_id?: string; ai_reasoning?: string }
  ): void {
    this.db
      .update(processedPosts)
      .set({
        status,
        ...(extra?.reply_id !== undefined ? { reply_id: extra.reply_id } : {}),
        ...(extra?.ai_reasoning !== undefined ? { ai_reasoning: extra.ai_reasoning } : {}),
      })
      .where(eq(processedPosts.post_id, postId))
      .run();
  }

  saveProcessedPost(record: NewProcessedPostRecord): void {
    this.db
      .insert(processedPosts)
      .values({
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
        created_at: record.created_at ?? sql`(datetime('now'))`,
      })
      .onConflictDoUpdate({
        target: processedPosts.post_id,
        set: {
          ai_score: record.ai_score ?? null,
          ai_reasoning: record.ai_reasoning ?? null,
          reply_text: record.reply_text ?? null,
          reply_id: record.reply_id ?? null,
          status: record.status,
        },
      })
      .run();
  }

  getDashboardData(): DashboardData {
    const statsResult = this.db
      .select({
        total_processed: sql<number>`count(*)`,
        queued_count: sql<number>`coalesce(sum(case when ${processedPosts.status} = 'QUEUED' then 1 else 0 end), 0)`,
        replied_count: sql<number>`coalesce(sum(case when ${processedPosts.status} = 'REPLIED' then 1 else 0 end), 0)`,
        dry_run_count: sql<number>`coalesce(sum(case when ${processedPosts.status} = 'DRY_RUN' then 1 else 0 end), 0)`,
        skipped_count: sql<number>`coalesce(sum(case when ${processedPosts.status} = 'SKIPPED' then 1 else 0 end), 0)`,
        expired_count: sql<number>`coalesce(sum(case when ${processedPosts.status} = 'EXPIRED' then 1 else 0 end), 0)`,
        failed_count: sql<number>`coalesce(sum(case when ${processedPosts.status} = 'FAILED' then 1 else 0 end), 0)`,
      })
      .from(processedPosts)
      .where(sql`date(${processedPosts.created_at}) = date('now')`)
      .get();

    const recentPosts = this.db
      .select()
      .from(processedPosts)
      .orderBy(desc(processedPosts.created_at))
      .limit(50)
      .all() as ProcessedPostRecord[];

    return {
      today: statsResult ?? {
        total_processed: 0,
        queued_count: 0,
        replied_count: 0,
        dry_run_count: 0,
        skipped_count: 0,
        expired_count: 0,
        failed_count: 0,
      },
      recentPosts,
    };
  }

  deletePost(postId: string): boolean {
    return this.sqlite.prepare("DELETE FROM processed_posts WHERE post_id = ?").run(postId).changes > 0;
  }
}

