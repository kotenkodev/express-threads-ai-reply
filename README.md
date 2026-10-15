# Multi-Product AI Social Listening & Auto-Reply Bot (Threads MVP)

Automated keyword-sourcing, AI relevance evaluation, and context-aware reply review app for Meta Threads.

Built according to the vibe-coded MVP philosophy: single-process Node.js + TypeScript, local SQLite deduplication, zero over-engineering, ready for 1-click Railway or VPS deployment.

---

## ⚡ Features

- **Multi-Product Campaign Architecture:** Load multiple product JSON files from [`products/`](products/README.md), each with its own discovery, writing, publishing, and model settings.
- **Official Meta Threads Graph API:** Compliant 2-step container creation and publishing flow via `https://graph.threads.net/v1.0`.
- **Intelligent AI Relevance Gate:** Single LLM call (via OpenAI SDK, compatible with OpenAI, Groq, OpenRouter, or Gemini) that checks relevance, outputs confidence score, rationale, and native, non-corporate reply matching the author's language.
- **Publishing Guardrails:**
  - **Sleep Windows:** Runs only during designated active hours.
  - **Author Cooldown:** Prevents spamming the same author (7-day deduplication window).
  - **Daily Reply Cap:** Hard cap on daily replies (e.g., 20/day).
  - **`DRY_RUN` Mode:** Runs end-to-end evaluation and stores records without calling Threads publish.
- **Single-File SQLite (`data/bot.db`):** Zero migration overhead, tracks processed posts, author interactions, and daily counts.
- **SQLite-Backed Queue Architecture (Zero Redis):** Scheduled sourcing adds matched posts to a manual review queue. Replies are published only via Send. Statuses: `QUEUED`, `SENDING`, `REJECTED`, `REPLIED`, `DRY_RUN`, `SKIPPED`, `EXPIRED`, `FAILED`.
- **Web Dashboard & Health API:**
  - `GET /` — Matched posts awaiting review, with Reject, Edit text, Regenerate response, and Send actions.
  - `GET /health` & `GET /status` — Service uptime, queue count, and campaign status.
  - `POST /run-once` & `POST /trigger` — Manual execution trigger.

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
Fill in your keys:
- `OPENAI_API_KEY`: Your OpenAI/Groq API key
- `THREADS_ACCESS_TOKEN`: Official Meta Threads user access token
- `DRY_RUN`: Set to `true` (default) for testing, or `false` for live posting.

Environment configuration is parsed once in `src/config/.env.ts` using Joi.
Invalid ports, boolean flags, URLs, and cron expressions fail at startup with
field names, without printing secret values. Restart after changing `.env`.

### Product JSON configuration

Add your product JSON files to `products/` (one object or an array per file).
Each has a unique `key` and its own product context, search phrases, relevance
threshold, draft limits, reply rules, token variable, publishing window, and
optional OpenAI-compatible model settings. Product files use Joi validation too.

See [the product configuration guide](products/README.md) and
[the original example](products/examples/briefgarden.json). The existing product
is configured in `products/yollly.json`. Copy the example into `products/`,
customize it, set `active: true`, add its token to `.env`, and restart the server.
The dashboard's product selector filters the queue and scopes Find new matches.

### 3. Run Locally
```bash
# Development (with hot reloading)
npm run dev

# Production build
npm run build
npm start
```

Visit [http://localhost:3000](http://localhost:3000) to view the activity dashboard.

### 4. Local HTTPS tunnel (Cloudflare)

Install [cloudflared](https://developers.cloudflare.com/tunnel/downloads/) once.
On Windows, run:

```powershell
winget install --id Cloudflare.cloudflared --exact
```

Open a new terminal after installation so the updated PATH is available.
Alternatively, set `CLOUDFLARED_PATH` in `.env` to the downloaded executable.
You can also place it in `.tools/cloudflared.exe` on Windows (or
`.tools/cloudflared` on macOS/Linux). The tunnel script detects this project-local
copy automatically, and `.tools/` is excluded from Git.

Start the server and tunnel in separate terminals:

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run tunnel
```

The tunnel reads `PORT` from `.env` (default `3000`) and prints a public
`https://<random-name>.trycloudflare.com` URL. Open that URL for the dashboard,
or append `/health` to check connectivity. Stop the tunnel with Ctrl+C.
No Cloudflare account or domain is needed; the URL changes on each restart.

The URL exposes the dashboard and manual trigger endpoints, which currently
have no authentication. Keep the URL private and use `DRY_RUN=true` for testing.
For an OAuth redirect, register the exact HTTPS URL and callback path with Meta;
the tunnel itself does not implement an OAuth callback route.

If a `config.yaml` exists in your user `.cloudflared` directory, temporarily
rename it before using Quick Tunnels. For a stable URL, use a named Cloudflare
tunnel with your own domain. See [Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

#### Alternative: ngrok

If Cloudflare times out requesting `https://api.trycloudflare.com/tunnel`, the
failure happens before it connects to your app. Check VPN/firewall/network
connectivity or use ngrok:

1. Install from [ngrok's official download page](https://ngrok.com/download/windows),
   or place the executable in `.tools/ngrok.exe` (Windows) / `.tools/ngrok` (Unix).
2. Create an ngrok account and copy your authtoken from its dashboard into `.env`
   as `NGROK_AUTHTOKEN=your_token`. Keep the token out of Git and chat.
3. With the app running, run `npm run tunnel:ngrok` and open its forwarding URL.

Optionally set `TUNNEL_PROVIDER=ngrok` in `.env` to use ngrok with `npm run tunnel`.
`NGROK_PATH` overrides the executable location; `PORT` selects the local app port
for either provider. An existing ngrok CLI authtoken configuration also works.

---

## 🐳 Docker & Railway Deployment

The repository includes a multi-stage [`Dockerfile`](file:///c:/Users/vadym/src/node-ai-social-reply-system/Dockerfile) configured for Node 22 slim with built-in SQLite persistence under `/app/data`.

To mount persistent storage on Railway or Docker:
```bash
docker build -t threads-ai-bot .
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data --env-file .env threads-ai-bot
```

## Reviewing matched posts

The UI lives in `public/index.html`, with `public/review.css` and `public/review.js`.
Both development and production serve these files; Docker includes them.

Only pending matched posts (`QUEUED`) appear. Rejected, skipped, expired, failed,
sent, and previously simulated posts stay in SQLite but leave the review queue.
Find new matches runs sourcing only; scheduled sourcing continues, with no automatic publishing.
Edit text unlocks the draft; Save text persists it. Send saves and uses the visible draft.
Regenerate uses the original post and campaign guidelines; a failed regeneration preserves the draft.
Send respects active hours, daily caps, post age, and `DRY_RUN`.
In dry-run mode it simulates completion without publishing to Threads.
Concurrent sends are serialized; posts claimed as `SENDING` cannot be sent again.
If the process stops during publishing, inspect Threads before manually resolving a
`SENDING` or `FAILED` record; the app does not automatically retry ambiguous sends.
