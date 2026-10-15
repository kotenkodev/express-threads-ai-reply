import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { Router, Request, Response } from "express";
import { env, readCredential } from "../config/env.js";
import { checkPublishingLimit } from "../providers/threads/client.js";

export interface ThreadsTokenExchangeResult {
  userId: string;
  username: string;
  accessToken: string;
  expiresIn: number;
}

/**
 * Calculates the exact redirect_uri to use for Meta Threads OAuth.
 * Compatible with ngrok tunnels and production domains.
 */
export function getRedirectUri(req?: Request): string {
  // 1. If request comes via an external tunnel (ngrok, cloudflare) or reverse proxy, prioritize it dynamically!
  if (req) {
    const forwardedHost = req.get("x-forwarded-host");
    const forwardedProto = req.get("x-forwarded-proto");
    const host = forwardedHost || req.get("host");

    if (forwardedHost || (host && !host.includes("localhost") && !host.includes("127.0.0.1"))) {
      const proto = forwardedProto || "https";
      return `${proto}://${host}/callback`;
    }
  }

  // 2. If explicitly configured with an external HTTPS URL in .env
  const configured = env.REDIRECT_URI || process.env.REDIRECT_URI;
  if (configured && !configured.includes("localhost") && configured.startsWith("https://")) {
    return configured.trim();
  }

  // 3. Fallback to local request host
  if (req) {
    const host = req.get("host") || "localhost:3000";
    const proto = req.get("x-forwarded-proto") || req.protocol || "http";
    return `${proto}://${host}/callback`;
  }

  return configured || "http://localhost:3000/callback";
}

/**
 * Generates the official Meta Threads OAuth authorization URL.
 */
export function getThreadsAuthorizationUrl(req?: Request): string {
  const appId = env.THREADS_APP_ID || process.env.THREADS_APP_ID;
  if (!appId) {
    throw new Error("Missing THREADS_APP_ID in .env file. Please add your Meta App ID.");
  }

  const redirectUri = getRedirectUri(req);
  console.log(`[OAuth] Initiating authorization with redirect_uri: ${redirectUri}`);
  const scope = "threads_basic,threads_content_publish,threads_manage_replies";

  return `https://threads.net/oauth/authorize?client_id=${encodeURIComponent(
    appId
  )}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&scope=${encodeURIComponent(scope)}&response_type=code`;
}

/**
 * Exchanges the authorization code received in /callback for:
 * 1. Short-lived token (1 hour)
 * 2. Long-lived token (60 days)
 * 3. Connected user profile information
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<ThreadsTokenExchangeResult> {
  const appId = env.THREADS_APP_ID || process.env.THREADS_APP_ID;
  const appSecret = env.THREADS_APP_SECRET || process.env.THREADS_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("Missing THREADS_APP_ID or THREADS_APP_SECRET in .env.");
  }

  console.log(`[OAuth] Step 1: Exchanging authorization code with redirect_uri: ${redirectUri}`);

  // 1. Exchange authorization code for short-lived token
  const tokenParams = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const shortRes = await axios.post<{ access_token: string; user_id: string }>(
    "https://graph.threads.net/oauth/access_token",
    tokenParams.toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    }
  );

  const shortLivedToken = shortRes.data?.access_token;
  const rawUserId = String(shortRes.data?.user_id || "");

  if (!shortLivedToken) {
    throw new Error(`Failed to obtain short-lived access token: ${JSON.stringify(shortRes.data)}`);
  }

  console.log("[OAuth] Step 2: Exchanging for 60-day long-lived access token...");

  // 2. Exchange short-lived token for 60-day long-lived access token
  const longRes = await axios.get<{ access_token: string; expires_in: number; token_type: string }>(
    "https://graph.threads.net/access_token",
    {
      params: {
        grant_type: "th_exchange_token",
        client_secret: appSecret,
        access_token: shortLivedToken,
      },
      timeout: 15000,
    }
  );

  const longLivedToken = longRes.data?.access_token || shortLivedToken;
  const expiresIn = longRes.data?.expires_in || 5184000; // 60 days in seconds

  console.log("[OAuth] Step 3: Fetching Threads profile info...");

  // 3. Fetch Threads username & profile
  let username = "";
  try {
    const meRes = await axios.get<{ id: string; username: string }>(
      "https://graph.threads.net/v1.0/me",
      {
        params: {
          fields: "id,username",
          access_token: longLivedToken,
        },
        timeout: 10000,
      }
    );
    username = meRes.data?.username || "";
  } catch (err) {
    console.warn(`[OAuth Warning] Could not fetch profile username: ${(err as Error).message}`);
  }

  // 4. Automatically persist the new token in process.env and .env file
  persistTokenToEnv(longLivedToken, username);

  return {
    userId: rawUserId,
    username,
    accessToken: longLivedToken,
    expiresIn,
  };
}

/**
 * Updates .env file with the newly authorized THREADS_ACCESS_TOKEN and THREADS_BOT_USERNAME.
 */
export function persistTokenToEnv(token: string, username?: string): void {
  process.env.THREADS_ACCESS_TOKEN = token;
  (env as Record<string, unknown>).THREADS_ACCESS_TOKEN = token;
  if (username) {
    process.env.THREADS_BOT_USERNAME = username;
    (env as Record<string, unknown>).THREADS_BOT_USERNAME = username;
  }

  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;

    let content = fs.readFileSync(envPath, "utf8");

    // Replace or append THREADS_ACCESS_TOKEN
    if (/^THREADS_ACCESS_TOKEN=.*/m.test(content)) {
      content = content.replace(/^THREADS_ACCESS_TOKEN=.*/m, `THREADS_ACCESS_TOKEN=${token}`);
    } else {
      content += `\nTHREADS_ACCESS_TOKEN=${token}`;
    }

    // Replace or append THREADS_BOT_USERNAME
    if (username) {
      if (/^THREADS_BOT_USERNAME=.*/m.test(content)) {
        content = content.replace(/^THREADS_BOT_USERNAME=.*/m, `THREADS_BOT_USERNAME=${username}`);
      } else {
        content += `\nTHREADS_BOT_USERNAME=${username}`;
      }
    }

    fs.writeFileSync(envPath, content, "utf8");
    console.log(`💾 [OAuth Persist] Updated THREADS_ACCESS_TOKEN in ${envPath}`);
  } catch (err) {
    console.warn(`[OAuth Warning] Could not write token to .env: ${(err as Error).message}`);
  }
}

/**
 * Persists the token refresh timestamp to .env
 */
export function persistLastRefreshToEnv(timestamp: string): void {
  process.env.THREADS_TOKEN_LAST_REFRESH = timestamp;
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;

    let content = fs.readFileSync(envPath, "utf8");
    if (/^THREADS_TOKEN_LAST_REFRESH=.*/m.test(content)) {
      content = content.replace(/^THREADS_TOKEN_LAST_REFRESH=.*/m, `THREADS_TOKEN_LAST_REFRESH=${timestamp}`);
    } else {
      content += `\nTHREADS_TOKEN_LAST_REFRESH=${timestamp}`;
    }
    fs.writeFileSync(envPath, content, "utf8");
  } catch {}
}

/**
 * Clears active Threads access token and username from environment and .env file.
 */
export function clearTokenFromEnv(): void {
  delete process.env.THREADS_ACCESS_TOKEN;
  delete process.env.THREADS_BOT_USERNAME;
  (env as Record<string, unknown>).THREADS_ACCESS_TOKEN = undefined;
  (env as Record<string, unknown>).THREADS_BOT_USERNAME = undefined;

  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;

    let content = fs.readFileSync(envPath, "utf8");
    if (/^THREADS_ACCESS_TOKEN=.*/m.test(content)) {
      content = content.replace(/^THREADS_ACCESS_TOKEN=.*/m, "THREADS_ACCESS_TOKEN=");
    }
    if (/^THREADS_BOT_USERNAME=.*/m.test(content)) {
      content = content.replace(/^THREADS_BOT_USERNAME=.*/m, "THREADS_BOT_USERNAME=");
    }
    fs.writeFileSync(envPath, content, "utf8");
    console.log(`🗑️ [OAuth Disconnect] Cleared THREADS_ACCESS_TOKEN in ${envPath}`);
  } catch (err) {
    console.warn(`[OAuth Warning] Could not clear token in .env: ${(err as Error).message}`);
  }
}

export interface AccountQuotaSummary {
  replyUsage: number;
  replyTotal: number;
  remainingReplies: number;
  postUsage: number;
  postTotal: number;
  quotaDurationHours: number;
}

/**
 * Queries Meta Threads API for the publishing quota of the currently active account.
 */
export async function getAccountQuota(token?: string): Promise<AccountQuotaSummary | null> {
  const activeToken = token || readCredential("THREADS_ACCESS_TOKEN");
  if (!activeToken) return null;

  try {
    const limits = await checkPublishingLimit("me", activeToken);
    const item = limits?.data?.[0];
    if (!item) return null;

    const replyUsage = typeof item.reply_quota_usage === "number" ? item.reply_quota_usage : 0;
    const replyTotal = item.reply_config?.quota_total ?? 1000;
    const postUsage = typeof item.quota_usage === "number" ? item.quota_usage : 0;
    const postTotal = item.config?.quota_total ?? 250;
    const quotaDurationHours = Math.round((item.reply_config?.quota_duration ?? 86400) / 3600);

    return {
      replyUsage,
      replyTotal,
      remainingReplies: Math.max(0, replyTotal - replyUsage),
      postUsage,
      postTotal,
      quotaDurationHours,
    };
  } catch {
    return null;
  }
}

/**
 * Auto-refreshes the Threads 60-day long-lived access token.
 * Meta allows token refresh once the token is at least 24 hours old.
 */
export async function refreshThreadsAccessToken(force: boolean = false): Promise<{
  success: boolean;
  refreshed: boolean;
  message: string;
  expiresIn?: number;
}> {
  const token = readCredential("THREADS_ACCESS_TOKEN");
  if (!token) {
    return { success: false, refreshed: false, message: "No active token to refresh." };
  }

  const lastRefreshStr = process.env.THREADS_TOKEN_LAST_REFRESH;
  if (!force && lastRefreshStr) {
    const lastRefresh = new Date(lastRefreshStr).getTime();
    const elapsedHours = (Date.now() - lastRefresh) / (1000 * 60 * 60);
    if (elapsedHours < 24) {
      return {
        success: true,
        refreshed: false,
        message: `Token was refreshed ${Math.round(elapsedHours)}h ago. Next auto-refresh available after 24h.`,
      };
    }
  }

  try {
    console.log("[OAuth] Refreshing 60-day Threads long-lived access token...");
    const res = await axios.get<{ access_token: string; token_type: string; expires_in: number }>(
      "https://graph.threads.net/refresh_access_token",
      {
        params: {
          grant_type: "th_refresh_token",
          access_token: token,
        },
        timeout: 15000,
      }
    );

    if (res.data?.access_token) {
      const newToken = res.data.access_token;
      const expiresIn = res.data.expires_in || 5184000;
      const nowIso = new Date().toISOString();

      persistTokenToEnv(newToken);
      persistLastRefreshToEnv(nowIso);

      console.log(`✅ [OAuth] Token refreshed! Valid for ~${Math.round(expiresIn / 86400)} days.`);
      return {
        success: true,
        refreshed: true,
        message: `Token refreshed successfully (valid for ~${Math.round(expiresIn / 86400)} days).`,
        expiresIn,
      };
    }
    return { success: false, refreshed: false, message: "No access token in Meta response." };
  } catch (err) {
    const msg =
      axios.isAxiosError(err) && err.response?.data?.error?.message
        ? err.response.data.error.message
        : (err as Error).message;
    console.warn(`[OAuth Refresh Warning]: ${msg}`);
    return { success: false, refreshed: false, message: msg };
  }
}

/**
 * Creates the Express Auth Router for Threads OAuth login and callback.
 */
export function createAuthRouter(): Router {
  const router = Router();

  // Status endpoint (includes active username and publishing quota)
  router.get("/status", async (req: Request, res: Response) => {
    const token = readCredential("THREADS_ACCESS_TOKEN");
    const username = readCredential("THREADS_BOT_USERNAME") || env.THREADS_BOT_USERNAME;
    const appId = env.THREADS_APP_ID || process.env.THREADS_APP_ID;
    const quota = token ? await getAccountQuota(token) : null;

    res.json({
      configured: Boolean(appId),
      hasToken: Boolean(token),
      username: username || (token ? "Connected" : null),
      redirectUri: getRedirectUri(req),
      quota,
    });
  });

  // Dedicated quota endpoint
  router.get("/quota", async (_req: Request, res: Response) => {
    const quota = await getAccountQuota();
    res.json({ success: true, quota });
  });

  // Manual token refresh trigger
  router.post("/refresh", async (_req: Request, res: Response) => {
    const result = await refreshThreadsAccessToken(true);
    res.json(result);
  });

  // Logout / Disconnect endpoints: POST always returns pure JSON!
  router.post("/logout", (_req: Request, res: Response) => {
    clearTokenFromEnv();
    return res.json({ success: true, message: "Disconnected Threads account successfully." });
  });

  router.get("/logout", (req: Request, res: Response) => {
    clearTokenFromEnv();
    if (req.xhr || req.headers["accept"]?.includes("application/json") || req.query.format === "json") {
      return res.json({ success: true, message: "Disconnected Threads account successfully." });
    }
    return res.redirect("/");
  });

  // Login trigger: redirects directly to Meta Threads OAuth
  router.get("/login", (req: Request, res: Response) => {
    try {
      const authUrl = getThreadsAuthorizationUrl(req);
      console.log(`[OAuth] Redirecting user to Threads authorization dialog:\n${authUrl}`);
      res.redirect(authUrl);
    } catch (err) {
      res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>OAuth Configuration Error</title><link rel="stylesheet" href="/review.css"></head>
        <body style="padding: 40px; font-family: sans-serif; background: #0f141c; color: #fff;">
          <h2>⚠️ OAuth Configuration Error</h2>
          <p>${(err as Error).message}</p>
          <p>Make sure <code>THREADS_APP_ID</code> and <code>THREADS_APP_SECRET</code> are set in your <code>.env</code> file.</p>
          <a href="/" style="color: #60a5fa;">← Return to dashboard</a>
        </body>
        </html>
      `);
    }
  });

  // Callback handler from Meta Threads OAuth
  router.get("/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    const error = req.query.error as string | undefined;
    const errorDesc = req.query.error_description as string | undefined;

    if (error || !code) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Failed</title><link rel="stylesheet" href="/review.css"></head>
        <body style="padding: 40px; font-family: sans-serif; background: #0f141c; color: #fff;">
          <h2>❌ Threads Connection Failed</h2>
          <p><strong>Error:</strong> ${error || "No authorization code received"}</p>
          <p>${errorDesc || "Authorization was cancelled or denied."}</p>
          <br>
          <a href="/auth/login" style="padding: 10px 16px; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 6px;">Try Again</a>
          <a href="/" style="margin-left: 12px; color: #94a3b8;">Back to Review</a>
        </body>
        </html>
      `);
    }

    try {
      const redirectUri = getRedirectUri(req);
      const result = await exchangeCodeForTokens(code, redirectUri);

      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Threads Account Connected</title>
          <link rel="stylesheet" href="/review.css">
          <meta http-equiv="refresh" content="3;url=/">
        </head>
        <body style="padding: 40px; font-family: sans-serif; background: #0f141c; color: #fff; text-align: center;">
          <div style="max-width: 500px; margin: 60px auto; padding: 32px; background: #1a2230; border-radius: 12px; border: 1px solid #2d3748;">
            <div style="font-size: 48px; margin-bottom: 16px;">🎉</div>
            <h2 style="margin: 0 0 12px; color: #4ade80;">Successfully Connected!</h2>
            <p style="font-size: 16px; color: #cbd5e1; margin-bottom: 24px;">
              Connected as <strong>@${result.username || result.userId}</strong>.
            </p>
            <p style="font-size: 14px; color: #94a3b8; margin-bottom: 24px;">
              Your 60-day publishing token is saved and active. All replies sent from the review dashboard will now post live under this account.
            </p>
            <a href="/" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold;">
              Go to Review Dashboard →
            </a>
            <p style="font-size: 12px; color: #64748b; margin-top: 16px;">Redirecting in 3 seconds...</p>
          </div>
        </body>
        </html>
      `);
    } catch (err) {
      console.error("[OAuth Callback Error]:", err);
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Token Exchange Error</title><link rel="stylesheet" href="/review.css"></head>
        <body style="padding: 40px; font-family: sans-serif; background: #0f141c; color: #fff;">
          <h2>❌ Token Exchange Failed</h2>
          <p>${(err as Error).message}</p>
          <br>
          <a href="/auth/login" style="padding: 10px 16px; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 6px;">Try Again</a>
          <a href="/" style="margin-left: 12px; color: #94a3b8;">Back to Review</a>
        </body>
        </html>
      `);
    }
  });

  return router;
}

export const authRouter = createAuthRouter();

