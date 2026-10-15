import "dotenv/config";
import axios from "axios";
import { searchKeywordPosts } from "../src/providers/threads/client.js";
import { campaigns } from "../src/config/campaigns.js";
import { recordSearchLog } from "../src/db.js";

const tokenSource = process.env.THREADS_ACCESS_TOKEN_V ? "THREADS_ACCESS_TOKEN_V" : "THREADS_ACCESS_TOKEN";
const token = process.env.THREADS_ACCESS_TOKEN_V || process.env.THREADS_ACCESS_TOKEN;

if (!token) {
  console.error("❌ THREADS_ACCESS_TOKEN_V (or THREADS_ACCESS_TOKEN) is missing in your .env file!");
  process.exit(1);
}

async function main() {
  const queryArg = process.argv.slice(2).join(" ").trim();
  const defaultKeyword = campaigns[0]?.keywords[0] || "просування в тредс";
  const query = queryArg || defaultKeyword;

  console.log("==================================================");
  console.log("🔍 Threads API Keyword Search Test (Axios)");
  console.log("==================================================");
  console.log(`🔑 Token source: ${tokenSource}`);
  console.log(`🔎 Searching for keyword: "${query}"`);
  console.log(`📡 Endpoint: /keyword_search (RECENT, KEYWORD mode)\n`);

  try {
    // 1. Verify token owner using axios
    const meRes = await axios.get("https://graph.threads.net/v1.0/me", {
      params: {
        fields: "id,username",
        access_token: token
      }
    });
    console.log(`👤 Token owner:`, meRes.data);

    // 2. Perform search using searchKeywordPosts (axios-powered)
    const startTime = Date.now();
    const posts = await searchKeywordPosts(query, token, "RECENT");
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✅ Completed in ${duration}s. Found ${posts.length} post(s).\n`);
    recordSearchLog(campaigns[0]?.id || "manual_test", query, posts.length);

    if (posts.length === 0) {
      console.log("ℹ️ No posts returned.");
      return;
    }

    posts.forEach((post, index) => {
      console.log(`--------------------------------------------------`);
      console.log(`#${index + 1} | @${post.username || "unknown"} (ID: ${post.id})`);
      console.log(`📅 Timestamp: ${post.timestamp}`);
      console.log(`🔗 Link: ${post.permalink || "N/A"}${post.shortcode ? ` (shortcode: ${post.shortcode})` : ""}`);
      console.log(`💬 Type: ${post.media_type || "POST"} | ${post.is_reply ? "Reply" : "Root post"}${post.is_quote_post ? " (Quote)" : ""}`);
      console.log(`📝 Text:`);
      const preview = (post.text || "").replace(/\n+/g, " ");
      console.log(`   ${preview.length > 200 ? preview.slice(0, 200) + "..." : preview || "(no text)"}`);
    });
    console.log(`--------------------------------------------------\n`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        "❌ Search failed [Axios HTTP Error]:",
        error.response?.status,
        JSON.stringify(error.response?.data, null, 2)
      );
    } else {
      console.error("❌ Search failed:", (error as Error).message);
    }
    process.exit(1);
  }
}

main();
