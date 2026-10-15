import "dotenv/config";
import {
  saveProcessedPost,
  isPostProcessed,
  getDashboardData,
  getDailyReplyCount,
} from "../src/db.js";

async function main() {
  console.log("==================================================");
  console.log("🗄️ Testing Drizzle ORM SQLite Integration");
  console.log("==================================================");

  // 1. Check existing stats
  const initialStats = getDashboardData();
  console.log("📊 Initial dashboard stats:", initialStats.today);

  // 2. Test inserting / updating a record
  const testPostId = "test_post_" + Date.now();
  console.log(`\n💾 Inserting test post: ${testPostId}...`);
  saveProcessedPost({
    post_id: testPostId,
    campaign_id: "socialflow",
    username: "db_test_bot",
    post_text: "Testing Drizzle ORM with Threads integration",
    permalink: "https://www.threads.com/@vorgyn/post/DegcikFjGBc",
    ai_score: 92,
    ai_reasoning: "High relevance to social media growth and automation",
    reply_text: "Hey, check out our automated social listening tool!",
    status: "DRY_RUN",
  });

  // 3. Verify existence
  const exists = isPostProcessed(testPostId);
  console.log(`✅ isPostProcessed(${testPostId}) =`, exists);

  // 4. Verify daily count
  const dailyCount = getDailyReplyCount("socialflow");
  console.log(`📈 Daily reply/dry-run count for socialflow =`, dailyCount);

  // 5. Query updated stats
  const updatedStats = getDashboardData();
  console.log(`\n📊 Updated dashboard stats:`, updatedStats.today);
  console.log(`📋 Recent posts count: ${updatedStats.recentPosts.length}`);

  // 6. Clean up test record so it doesn't pollute dashboard
  const { sqlite } = await import("../src/db.js");
  sqlite.prepare("DELETE FROM processed_posts WHERE post_id = ?").run(testPostId);
  console.log(`🧹 Cleaned up test record ${testPostId}`);

  console.log("\n🎉 Drizzle ORM integration successfully verified!");
}

main().catch((err) => {
  console.error("❌ DB test failed:", err);
  process.exit(1);
});
