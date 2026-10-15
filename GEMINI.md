````markdown
# Project: Multi-Product AI Social Listening & Auto-Reply Bot (Threads MVP)

## 1. Philosophy & Constraints (VIBE-CODED MVP)

- **Goal:** Build a dead-simple, working MVP of an automated Threads keyword-sourcing and AI-commenting service.
- **Zero Over-Engineering:** Do NOT use complex microservices, Redis, BullMQ, or external database clusters yet. Everything must run inside a single process on Node.js (v22+) or Bun with TypeScript, ready to deploy as a single service on Railway or a small VPS.
- **Persistence:** Use local SQLite (`better-sqlite3` or `bun:sqlite`) in a single file (`data/bot.db`) ONLY to track seen posts, replied authors, and daily reply counts so we don't spam the same people or lose state on restart.
- **Multi-Product Flexibility:** All products/campaigns, keywords, prompts, and account tokens must be loaded from a single, easy-to-edit configuration file (`src/config/campaigns.ts` or `campaigns.json`). Adding a new product or account must only require adding a new object to this config.

## 2. Tech Stack

- **Runtime:** Node.js + TypeScript (`tsx`) or Bun
- **HTTP Server:** Fastify or Express (minimal API just for `/health`, `/status` to see recent logs/stats, and `/trigger` for manual test runs)
- **Database:** SQLite (auto-initialized on startup, zero migrations needed)
- **AI SDK:** OpenAI SDK (`openai` package — compatible with OpenAI, Groq, or Gemini)
- **Scheduling:** Simple in-process loop with randomized `setTimeout` (jitter) + `node-cron`

## Queue Architecture (SQLite-Backed Queue, No Redis)

Decouple sourcing from posting using the SQLite `processed_posts` table as a persistent queue (`status`: `'SKIPPED' | 'QUEUED' | 'REPLIED' | 'FAILED' | 'EXPIRED' | 'DRY_RUN'`):

1. **Sourcing Producer Loop:** Runs every 20-30 minutes per campaign. Fetches posts, runs AI evaluation/generation, and saves matching posts with `status = 'QUEUED'` and the generated `reply_text`.
2. **Posting Consumer Loop:** Runs independently per campaign with randomized jitter (`minDelaySeconds` to `maxDelaySeconds`). On each tick, if within active hours and under daily limit, it picks 1 post (`WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1`), verifies the post isn't older than `maxPostAgeMinutes` (marking as `'EXPIRED'` if too old), publishes the reply via Threads API, and updates `status = 'REPLIED'`.

## 3. Core Workflow (The 4-Step Loop)

### Step 1: Sourcing Posts (Official Meta Threads API)

- Periodically iterate over active campaigns in the config.
- Pick a keyword from the campaign's `keywords` list and search recent posts using the official Threads Keyword Search endpoint.
- **Deduplication Check:** Skip any post if:
  1. `post.id` already exists in the SQLite `processed_posts` table.
  2. We have already replied to `post.username` within the last 7 days for this campaign.
  3. The post is older than `maxPostAgeMinutes` (e.g., 180 minutes).

### Step 2: AI Relevance Filter & Reply Generation (Single LLM Call)

- Send the post text, username, and the campaign's `productContext` + `replyGuidelines` to the LLM (`gpt-4o-mini` or configurable model) with `response_format: { type: "json_object" }`.
- The LLM must return:
  ```json
  {
    "isRelevant": true,
    "confidenceScore": 85,
    "reasoning": "User is explicitly asking for recommendations on...",
    "replyText": "casual, native 1-2 sentence reply mentioning the product naturally"
  }
  ```
````

- **Strict Prompt Rules for the Reply:**
- Never sound like a corporate bot or ad. No emojis spam, no exclamation mark overuse, no "Check out this amazing app!".
- Match the language of the original post (Ukrainian, English, etc.).
- Reference a specific detail from the user's post so it feels human.
- Mention the product naturally (e.g., product website or just the brand name/handle as configured in the campaign).

- If `isRelevant === false` or `confidenceScore < campaign.minConfidenceScore`, save the post in SQLite as `SKIPPED` and move on.

### Step 3: Anti-Ban & Rate Limit Guardrails

Before publishing a reply, enforce these safety checks:

1. **Active Hours (Sleep Window):** Only publish replies during the campaign's configured active hours (e.g., `09:00` to `23:00` in the target timezone) so the account doesn't act like a 24/7 bot.
2. **Daily Cap:** Check SQLite to ensure the account hasn't exceeded `campaign.dailyReplyLimit` (e.g., 20 replies/day, well below Meta's 1,000 API limit) or search limit (2,200/24h).
3. **Human Jitter (Random Delay):** Never reply immediately after finding a post or fire replies back-to-back. Wait a randomized delay between `minDelaySeconds` and `maxDelaySeconds` (e.g., 120 to 600 seconds) between replies.
4. **DRY_RUN Mode:** Support `DRY_RUN=true` in `.env`. When enabled, execute sourcing and AI generation, log the generated reply to console and SQLite as `DRY_RUN`, but do NOT call the Threads publish endpoints.

### Step 4: Publishing the Reply (Official Threads API 2-Step Flow)

Use the official Meta Threads Graph API (`https://graph.threads.net/v1.0`).

## 4. Exact Meta Threads API Reference (DO NOT HALLUCINATE ENDPOINTS)

**Base URL:** `https://graph.threads.net/v1.0`
**Auth:** Pass `access_token` as a query parameter or Bearer token.

### A. Keyword Search Endpoint

- **Request:**
  `GET https://graph.threads.net/v1.0/keyword_search`
- **Query Params:**
- `q`: string (the keyword)
- `search_type`: `RECENT` (or `TOP`)
- `search_mode`: `KEYWORD`
- `fields`: `id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply`
- `access_token`: `<THREADS_ACCESS_TOKEN>`

- **Note:** Filter out posts where `is_reply === true` if we only want to comment on root threads.

### B. Publishing a Reply (2-Step Process)

1. **Create Reply Media Container:**

- **Request:** `POST https://graph.threads.net/v1.0/me/threads` (or `/{threads_user_id}/threads`)
- **Params / Body (form-urlencoded or JSON):**
- `media_type`: `TEXT`
- `text`: `<generated_reply_text>`
- `reply_to_id`: `<target_post_id>`
- `access_token`: `<THREADS_ACCESS_TOKEN>`

- **Response:** `{ "id": "<creation_id>" }`

2. **Wait ~15–30 seconds** (recommended by Meta docs for container processing).
3. **Publish Reply Container:**

- **Request:** `POST https://graph.threads.net/v1.0/me/threads_publish` (or `/{threads_user_id}/threads_publish`)
- **Params / Body:**
- `creation_id`: `<creation_id>`
- `access_token`: `<THREADS_ACCESS_TOKEN>`

- **Response:** `{ "id": "<published_reply_id>" }`

### C. Check Publishing Quota (Optional Helper)

- `GET https://graph.threads.net/v1.0/me/threads_publishing_limit?fields=reply_quota_usage,reply_config&access_token=<TOKEN>`

## 5. Multi-Product Campaign Config Shape (`src/config/campaigns.ts`)

Design the config array with this exact structure so we can plug in any product:

```typescript
export interface CampaignConfig {
  id: string;
  enabled: boolean;
  productName: string;
  productUrl: string;
  productContext: string; // What the product does, target audience, pain points solved
  replyGuidelines: string; // Tone of voice, how to mention the link/brand
  keywords: string[];
  minConfidenceScore: number; // e.g., 75
  maxPostAgeMinutes: number; // e.g., 240
  account: {
    threadsUserId: string; // or "me"
    accessTokenEnvVar: string; // e.g., "THREADS_ACCESS_TOKEN"
    dailyReplyLimit: number; // e.g., 20
    activeHoursStart: number; // e.g., 9 (9 AM)
    activeHoursEnd: number; // e.g., 22 (10 PM)
    minDelaySeconds: number; // e.g., 180
    maxDelaySeconds: number; // e.g., 600
  };
}
```

Pre-populate the config with a working example campaign.

## 6. Deliverables to Generate Right Now

1. `package.json`, `tsconfig.json`, `.env.example`, and `Dockerfile` (ready for 1-click Railway deploy).
2. `src/config/campaigns.ts` — Multi-product configuration with an example campaign pre-configured.
3. `src/db.ts` — Single-file SQLite setup (`processed_posts` table storing `post_id`, `campaign_id`, `username`, `post_text`, `permalink`, `ai_score`, `ai_reasoning`, `reply_text`, `reply_id`, `status`, `created_at`).
4. `src/threads-api.ts` — Clean wrapper around `keyword_search`, `createReplyContainer`, and `publishReplyContainer` with error handling.
5. `src/ai.ts` — LLM evaluator + reply generator returning structured JSON.
6. `src/worker.ts` — The main loop handling keyword rotation, deduplication, active hours check, daily limits, jitter delays, and `DRY_RUN` mode.
7. `src/index.ts` — Server entrypoint with:

- `GET /` — Simple HTML or JSON dashboard showing today's stats, recent processed posts, AI scores, and sent replies.
- `POST /run-once` — Manual trigger endpoint to test a single keyword cycle immediately during development.

```


```
