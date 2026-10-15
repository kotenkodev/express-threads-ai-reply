import "dotenv/config";
import { getPostSourceProvider } from "../src/providers/factory.js";
import { campaigns } from "../src/config/campaigns.js";
import { recordSearchLog } from "../src/db.js";

async function main() {
  const queryArg = process.argv.slice(2).join(" ").trim();
  const defaultKeyword = campaigns[0]?.keywords[0] || "сніданок";
  const query = queryArg || defaultKeyword;
  const campaign = campaigns[0];

  console.log("==================================================");
  console.log("🔍 Threads Scraper Post Search Test");
  console.log("==================================================");

  const provider = getPostSourceProvider(campaign);
  console.log(`📡 Active Scraper Provider: [${provider.name}]`);
  console.log(`🔎 Searching for keyword: "${query}"\n`);

  try {
    const startTime = Date.now();
    const posts = await provider.searchPosts({
      keyword: query,
      campaign,
      limit: 10,
      searchType: "RECENT",
    });
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✅ Completed in ${duration}s. Found ${posts.length} post(s).\n`);
    recordSearchLog(campaign?.id || "manual_test", query, posts.length);

    if (posts.length === 0) {
      console.log("ℹ️ No posts returned.");
      return;
    }

    posts.forEach((post, index) => {
      console.log(`--------------------------------------------------`);
      console.log(`#${index + 1} | @${post.username || "unknown"} (ID: ${post.id})`);
      console.log(`📅 Timestamp: ${post.timestamp}`);
      console.log(`🔗 Link: ${post.permalink || "N/A"}`);
      console.log(`🔖 Shortcode: ${post.shortcode || "N/A"}`);
      console.log(`💬 Type: ${post.mediaType || "POST"} | ${post.isReply ? "Reply" : "Root post"}`);
      console.log(`📝 Text:`);
      const preview = (post.text || "").replace(/\n+/g, " ");
      console.log(`   ${preview.length > 200 ? preview.slice(0, 200) + "..." : preview || "(no text)"}`);
    });
    console.log(`--------------------------------------------------\n`);
  } catch (error) {
    console.error("❌ Search failed:", (error as Error).message);
    process.exit(1);
  }
}

main();
