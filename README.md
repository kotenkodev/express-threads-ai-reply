# Multi-Product AI Social Listening & Smart Reply System (Threads)

Automated keyword-sourcing, AI relevance evaluation, context-aware reply generation, and safe human-in-the-loop review dashboard for Threads.

Built with Node.js + TypeScript, modular scraper providers, and zero-ban publishing via Threads Web Intents.

---

## ⚡ Features

- **Safe Human-in-the-Loop Web Intent Flow (Zero-Ban Risk):**
  - Meta strictly restricts direct API comment posting without extensive business verification.
  - Instead of risking bot account bans, the system uses native **Threads Web Intents** (`threads.net/intent/post`). Clicking **"Post Reply"** opens Threads directly with the AI-crafted reply pre-filled in the reply box. You review and hit publish.
- **Multi-Product Campaign Architecture:**
  - Switch easily between products (e.g. Yollly, Briefgarden) directly from the dashboard.
  - Each product has its own keywords, brand positioning, and draft settings stored in `products/<name>.json`.
- **Live In-Dashboard Campaign & Keyword Editor:**
  - Click **"⚙️ Products & Keywords"** in the web dashboard to edit keywords, negative filters, and system prompt instructions on the fly without touching code or restarting the server.
- **Flexible Scraper & Sourcing Adapters:**
  - **Apify Integration:** Out-of-the-box support for `burbn~threads-search-scraper` or any custom Apify actor.
  - **Custom Microservice / RapidAPI / Self-Hosted:** Connect any external or local Python/Node scraper endpoint via simple `.env` settings (`SCRAPER_ENDPOINT`).
  - **Built-in Fallback Engine:** Automatic failover to an internal generator if third-party scraper limits or quotas are reached.
- **Multi-Keyword Batch Scanning:**
  - Sourcing cycles through multiple targeted search phrases per run, collecting up to 20 qualified drafts per batch.
- **Intelligent AI Relevance Gate:**
  - Single LLM call (OpenAI, Groq, OpenRouter, or Gemini) that checks relevance, outputs confidence score, rationale, and a native, non-corporate reply matching the author's language.
- **Clean Light Theme Review Dashboard:**
  - `GET /` — Responsive web interface to review matched posts, edit drafts, regenerate responses, or launch Threads replies.
  - Live warning banner showing third-party scraper status or quota limits.

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Key variables in `.env`:

- `OPENAI_API_KEY`: Your OpenAI, Groq, or OpenRouter API key.
- `OPENAI_MODEL`: Model ID (e.g. `qwen/qwen3.8-27b` on Groq or `gpt-4o-mini`).
- `POST_SOURCE_PROVIDER`: Sourcing engine (`scraper` or `threads-api`).
- `APIFY_TOKEN`: (Optional) Your Apify API token for live Threads search.
- `APIFY_ACTOR`: (Optional) Apify actor name (defaults to `burbn~threads-search-scraper`).
- `SCRAPER_ENDPOINT`: (Optional) Custom scraper API endpoint (RapidAPI, Python scraper, etc.).
- `SCRAPER_API_KEY`: (Optional) API key for custom scraper endpoint.
- `DB_ADAPTER`: Storage backend (`memory`).

---

## 🔌 Connecting Scrapers

The app supports multiple scraper providers out of the box:

### 1. Apify Threads Scraper (Default)

Add your token to `.env`:

```env
POST_SOURCE_PROVIDER=scraper
APIFY_TOKEN=apify_api_your_token_here
```

By default it runs `burbn~threads-search-scraper`. You can switch actors anytime via `APIFY_ACTOR=author~actor-name`.

### 2. Custom Scraper / RapidAPI / Local Microservice

If you run your own scraper (Python Playwright, Botasaurus, etc.) or use a RapidAPI provider:

```env
POST_SOURCE_PROVIDER=scraper
SCRAPER_ENDPOINT=https://your-custom-scraper.com/api/search
SCRAPER_API_KEY=your_optional_key
```

The scraper normalizer automatically accepts responses formatted as an array or wrapped in `{ items: [...] }` / `{ data: [...] }` with standard fields (`text`/`caption`, `postUrl`/`url`, `username`/`author`, `postId`/`id`).

### 3. Built-in Fallback Simulator

If no Apify token is provided or if external scrapers hit a monthly limit (HTTP 403 / 429), the system automatically falls back to an internal engine to keep the UI interactive and testable.

---

### 3. Run Locally

```bash
# Development (with hot reloading)
npm run dev

# Production build
npm run build
npm start
```

Visit [http://localhost:3000](http://localhost:3000) to view the activity dashboard.

---

## 🎯 Reviewing & Posting Workflow

The UI lives in `public/index.html` with `public/review.css` and `public/review.js`.

1. **Find New Matches:** Click "Find new matches" or select your product to scan for relevant Threads posts.
2. **Review & Edit:** Review the AI-generated draft, edit the response if needed, or click "Regenerate" to generate a new variation.
3. **Post Reply (Web Intent):** Click **"Post Reply"**. The system instantly opens the exact Threads post in your browser with your reply already filled into the comment composer. You make any final touches and hit publish safely without bot bans.
4. **Reject:** Click "Reject" to dismiss irrelevant posts from your queue.
