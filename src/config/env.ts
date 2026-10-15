import "dotenv/config";
import { z } from "zod";
import cron from "node-cron";

const booleanCoerce = z.preprocess((val) => {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const lower = val.trim().toLowerCase();
    if (lower === "true" || lower === "1") return true;
    if (lower === "false" || lower === "0") return false;
  }
  return val;
}, z.boolean());

export const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DRY_RUN: booleanCoerce.default(true),
  USE_MOCK_POSTS: booleanCoerce.default(false),
  CRON_SCHEDULE: z
    .string()
    .refine((val) => cron.validate(val), { message: "Invalid cron expression" })
    .default("*/20 * * * *"),
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-4o-mini"),
  OPENAI_BASE_URL: z.preprocess(
    (val) => (val === "" ? undefined : val),
    z
      .string()
      .url()
      .refine(
        (val) => {
          try {
            const url = new URL(val);
            return !url.username && !url.password;
          } catch {
            return false;
          }
        },
        { message: "URL must not contain embedded credentials" }
      )
      .optional()
  ),
  PRODUCTS_DIR: z.preprocess((val) => (val === "" ? undefined : val), z.string().trim().min(1).optional()),
  THREADS_BOT_USERNAME: z.preprocess((val) => (val === "" ? undefined : val), z.string().trim().optional()),
  POST_SOURCE_PROVIDER: z.enum(["threads_api", "scraper", "mock"]).default("threads_api"),
  DB_ADAPTER: z.enum(["memory", "sqlite"]).default("memory"),
  SCRAPER_ENDPOINT: z.preprocess((val) => (val === "" ? undefined : val), z.string().url().optional()),
  SCRAPER_API_KEY: z.string().optional(),
  APIFY_TOKEN: z.string().optional(),
  APIFY_ACTOR: z.string().default("burbn~threads-search-scraper"),
  OPENAI_API_KEY: z.string().optional(),
  THREADS_ACCESS_TOKEN: z.string().optional(),
  THREADS_ACCESS_TOKEN_V: z.string().optional(),
  THREADS_APP_ID: z.preprocess((val) => (val === "" || val === undefined ? undefined : String(val)), z.string().optional()),
  THREADS_APP_SECRET: z.string().optional(),
  REDIRECT_URI: z.string().optional(),
}).passthrough();

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(input: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((e) => `${e.path.join(".") || "root"}: ${e.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${errorDetails}`);
  }
  return result.data;
}

export const env: Environment = parseEnvironment(process.env as Record<string, unknown>);

export function readCredential(name: string): string | undefined {
  return process.env[name] || undefined;
}
