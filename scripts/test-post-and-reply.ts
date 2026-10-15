import "dotenv/config";
import axios, { AxiosRequestConfig } from "axios";

const BASE_URL = "https://graph.threads.net/v1.0";
const token = process.env.THREADS_ACCESS_TOKEN || process.env.THREADS_ACCESS_TOKEN_V;

if (!token) {
  console.error("❌ THREADS_ACCESS_TOKEN is missing in your .env file!");
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest<T>(url: string, config: AxiosRequestConfig = {}): Promise<T> {
  try {
    const res = await axios<T>({
      url,
      ...config,
    });
    return res.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`API Error [HTTP ${error.response?.status}]: ${JSON.stringify(error.response?.data, null, 2)}`);
    }
    throw error;
  }
}

async function deleteThreadsMedia(mediaId: string, accessToken: string): Promise<boolean> {
  try {
    const res = await axios.delete<{ success?: boolean; error?: unknown }>(
      `${BASE_URL}/${mediaId}`,
      {
        params: { access_token: accessToken }
      }
    );
    if (res.data?.success) {
      console.log(`   🗑️ Successfully deleted test post/reply ${mediaId}`);
      return true;
    } else {
      console.warn(`   ⚠️ Meta could not delete ${mediaId}:`, JSON.stringify(res.data));
      return false;
    }
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.warn(`   ⚠️ Meta could not delete ${mediaId}:`, JSON.stringify(err.response?.data || err.message));
    } else {
      console.warn(`   ⚠️ Network error deleting ${mediaId}:`, (err as Error).message);
    }
    return false;
  }
}

async function main() {
  console.log("==================================================");
  console.log("🧵 Threads API Direct Post & Reply Test Script (Axios)");
  console.log("==================================================\n");

  let publishedRootId: string | null = null;
  let publishedReplyId: string | null = null;

  try {
    // 1. Verify User Profile
    console.log("1️⃣ Verifying token with Meta Threads /me endpoint...");
    const me = await apiRequest<{ id: string; username: string }>(
      `${BASE_URL}/me`,
      {
        method: "GET",
        params: { fields: "id,username", access_token: token }
      }
    );
    console.log(`✅ Authenticated as: @${me.username} (ID: ${me.id})\n`);

    // 2. Create Root Post Media Container
    const rootText = `🧪 Testing Meta Threads API integration! (${new Date().toLocaleTimeString()})\nAutomated post verification script.`;
    console.log(`2️⃣ Step 1/2: Creating root post container...`);
    console.log(`   Text: "${rootText}"`);

    const rootContainerBody = new URLSearchParams({
      media_type: "TEXT",
      text: rootText,
      access_token: token
    });

    const rootContainer = await apiRequest<{ id: string }>(
      `${BASE_URL}/me/threads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: rootContainerBody.toString()
      }
    );
    console.log(`✅ Root post container created! Creation ID: ${rootContainer.id}`);

    // Meta advises waiting 15-20s for container processing
    console.log("⏳ Waiting 15 seconds for Meta to process the container...");
    await sleep(15000);

    // 3. Publish Root Post
    console.log("3️⃣ Step 2/2: Publishing root post...");
    const rootPublishBody = new URLSearchParams({
      creation_id: rootContainer.id,
      access_token: token
    });

    const publishedRoot = await apiRequest<{ id: string }>(
      `${BASE_URL}/me/threads_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: rootPublishBody.toString()
      }
    );
    publishedRootId = publishedRoot.id;
    console.log(`🎉 ROOT POST PUBLISHED! Post ID: ${publishedRootId}\n`);

    // 4. Create Reply Media Container
    const replyText = `💬 This is an automated reply test to post ${publishedRootId}! Two-step publishing flow confirmed.`;
    console.log(`4️⃣ Step 1/2: Creating reply container for post ${publishedRootId}...`);
    console.log(`   Reply text: "${replyText}"`);

    const replyContainerBody = new URLSearchParams({
      media_type: "TEXT",
      text: replyText,
      reply_to_id: publishedRootId,
      access_token: token
    });

    const replyContainer = await apiRequest<{ id: string }>(
      `${BASE_URL}/me/threads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: replyContainerBody.toString()
      }
    );
    console.log(`✅ Reply container created! Creation ID: ${replyContainer.id}`);

    console.log("⏳ Waiting 15 seconds for Meta to process the reply container...");
    await sleep(15000);

    // 5. Publish Reply
    console.log("5️⃣ Step 2/2: Publishing reply...");
    const replyPublishBody = new URLSearchParams({
      creation_id: replyContainer.id,
      access_token: token
    });

    const publishedReply = await apiRequest<{ id: string }>(
      `${BASE_URL}/me/threads_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: replyPublishBody.toString()
      }
    );
    publishedReplyId = publishedReply.id;
    console.log(`🎉 REPLY PUBLISHED! Reply ID: ${publishedReplyId}\n`);

    console.log("==================================================");
    console.log("🎯 SUCCESS! Post and reply created successfully.");
    console.log(`👉 https://www.threads.net/@${me.username}`);
    console.log("==================================================");

    // Small delay so user or API can register before cleanup
    console.log("\n⏳ Pausing 5 seconds before self clean up...");
    await sleep(5000);
  } finally {
    // 6. Self Clean Up
    console.log("\n🧹 [Self Clean Up] Deleting created test post and reply...");
    if (publishedReplyId) {
      console.log(`   Deleting test reply ${publishedReplyId}...`);
      await deleteThreadsMedia(publishedReplyId, token);
    }
    if (publishedRootId) {
      console.log(`   Deleting test root post ${publishedRootId}...`);
      await deleteThreadsMedia(publishedRootId, token);
    }
    console.log("✨ [Self Clean Up] Finished cleaning up test items.\n");
  }
}

main().catch((err) => {
  console.error("\n❌ Test Failed:", (err as Error).message);
  process.exit(1);
});
