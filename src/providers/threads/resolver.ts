import axios from "axios";
import { readCredential } from "../../config/env.js";

export interface PostToResolve {
  id: string;
  permalink?: string;
  text?: string;
  username?: string;
}

/**
 * Attempts to resolve a third-party scraped post (which has a web BigInt ID, shortcode, or fallback ID)
 * to an official Meta Threads Graph API App-Scoped Media ID.
 */
export async function resolveThreadsMediaId(
  post: PostToResolve,
  accessToken?: string
): Promise<string | null> {
  const token = accessToken || readCredential("THREADS_ACCESS_TOKEN");
  if (!token) return null;

  // 1. If it's already a valid 16-18 digit Meta Graph API ID
  if (/^\d{16,18}$/.test(post.id)) {
    return post.id;
  }

  // Extract shortcode from permalink if available (e.g. /post/Dee48XDDPnW)
  const shortcodeMatch = post.permalink?.match(/\/post\/([A-Za-z0-9_-]+)/);
  const shortcode = shortcodeMatch ? shortcodeMatch[1] : null;

  console.log(
    `[ID Resolver] Attempting to resolve post (ID: ${post.id}, shortcode: ${shortcode || "none"}, user: @${post.username || "unknown"})...`
  );

  // 2. Check if the post belongs to the connected account via /me/threads
  try {
    const meRes = await axios.get<{
      data: Array<{ id: string; permalink?: string; shortcode?: string; text?: string; username?: string }>;
    }>("https://graph.threads.net/v1.0/me/threads", {
      params: {
        fields: "id,permalink,shortcode,text,username",
        limit: 50,
        access_token: token,
      },
      timeout: 10000,
    });

    const items = meRes.data?.data || [];
    const matched = items.find((item) => {
      if (shortcode && (item.shortcode === shortcode || item.permalink?.includes(shortcode))) return true;
      if (post.text && item.text && item.text.trim() === post.text.trim()) return true;
      return false;
    });

    if (matched) {
      console.log(`[ID Resolver] ✅ Resolved via /me/threads: ${post.id} -> ${matched.id}`);
      return matched.id;
    }
  } catch (err) {
    console.warn(`[ID Resolver] /me/threads check failed: ${(err as Error).message}`);
  }

  // 3. Search official Meta keyword_search for the post's text or keywords
  if (post.text || post.username) {
    try {
      const cleanWords = (post.text || "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 3)
        .join(" ");

      const searchQuery = cleanWords || post.username;

      if (searchQuery) {
        const searchRes = await axios.get<{
          data: Array<{ id: string; permalink?: string; shortcode?: string; username?: string; text?: string }>;
        }>("https://graph.threads.net/v1.0/keyword_search", {
          params: {
            q: searchQuery,
            search_type: "RECENT",
            search_mode: "KEYWORD",
            fields: "id,permalink,shortcode,username,text",
            access_token: token,
          },
          timeout: 10000,
        });

        const results = searchRes.data?.data || [];
        const match = results.find((r) => {
          if (shortcode && (r.shortcode === shortcode || r.permalink?.includes(shortcode))) return true;
          if (post.username && r.username?.toLowerCase() === post.username.toLowerCase()) return true;
          if (post.text && r.text && r.text.includes(post.text.slice(0, 30))) return true;
          return false;
        });

        if (match) {
          console.log(`[ID Resolver] ✅ Resolved via keyword_search: ${post.id} -> ${match.id}`);
          return match.id;
        }
      }
    } catch (err) {
      console.warn(`[ID Resolver] keyword_search check failed: ${(err as Error).message}`);
    }
  }

  return null;
}

