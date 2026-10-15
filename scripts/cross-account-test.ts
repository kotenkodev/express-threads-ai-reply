import "dotenv/config";
import axios, { AxiosRequestConfig } from "axios";

const BASE_URL = "https://graph.threads.net/v1.0";
const tokenV = process.env.THREADS_ACCESS_TOKEN_V;
const tokenL = process.env.THREADS_ACCESS_TOKEN_USER_l;

if (!tokenV || !tokenL) {
  console.error(
    "❌ Both THREADS_ACCESS_TOKEN_V and THREADS_ACCESS_TOKEN_USER_l must be defined in .env!",
  );
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
      throw new Error(
        `API Error [HTTP ${error.response?.status}]: ${JSON.stringify(error.response?.data, null, 2)}`,
      );
    }
    throw error;
  }
}

async function deleteThreadsMedia(
  mediaId: string,
  accessToken: string,
): Promise<boolean> {
  try {
    const res = await axios.delete<{ success?: boolean; error?: unknown }>(
      `${BASE_URL}/${mediaId}`,
      {
        params: { access_token: accessToken },
      },
    );
    if (res.data?.success) {
      console.log(`   🗑️ Successfully deleted test media ${mediaId}`);
      return true;
    } else {
      console.warn(
        `   ⚠️ Meta could not delete ${mediaId}:`,
        JSON.stringify(res.data),
      );
      return false;
    }
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.warn(
        `   ⚠️ Meta could not delete ${mediaId}:`,
        JSON.stringify(err.response?.data || err.message),
      );
    } else {
      console.warn(
        `   ⚠️ Network error deleting ${mediaId}:`,
        (err as Error).message,
      );
    }
    return false;
  }
}

async function main() {
  console.log("==================================================");
  console.log("👥 Threads Cross-Account Post & Reply Test (Axios)");
  console.log("==================================================\n");

  let publishedPostId: string | null = null;
  let publishedReplyId: string | null = null;

  try {
    // 1. Identify Both Accounts
    console.log("1️⃣ Identifying accounts...");
    const [userV, userL] = await Promise.all([
      apiRequest<{ id: string; username: string }>(`${BASE_URL}/me`, {
        method: "GET",
        params: { fields: "id,username", access_token: tokenV },
      }),
      apiRequest<{ id: string; username: string }>(`${BASE_URL}/me`, {
        method: "GET",
        params: { fields: "id,username", access_token: tokenL },
      }),
    ]);

    console.log(`👤 Account 1 (Author): @${userV.username} (ID: ${userV.id})`);
    console.log(
      `👤 Account 2 (Replier): @${userL.username} (ID: ${userL.id})\n`,
    );

    // 2. Account 1 (@vorgyn) publishes a Root Post
    const postText = `Hey Threads!`;
    console.log(
      `2️⃣ [Account 1: @${userV.username}] Creating root post container...`,
    );
    console.log(`   Text: "${postText}"`);

    const rootBody = new URLSearchParams({
      media_type: "TEXT",
      text: postText,
      access_token: tokenV,
    });

    const rootContainer = await apiRequest<{ id: string }>(
      `${BASE_URL}/me/threads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: rootBody.toString(),
      },
    );
    console.log(`✅ Root container created! Creation ID: ${rootContainer.id}`);

    console.log(
      "⏳ Waiting 15s for Meta to process the root post container...",
    );
    await sleep(15000);

    const rootPublishBody = new URLSearchParams({
      creation_id: rootContainer.id,
      access_token: tokenV,
    });

    const publishedPost = await apiRequest<{ id: string }>(
      `${BASE_URL}/me/threads_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: rootPublishBody.toString(),
      },
    );
    publishedPostId = publishedPost.id;
    console.log(
      `🎉 [Account 1: @${userV.username}] Root post published! Post ID: ${publishedPostId}\n`,
    );

    // 3. Account 2 (@_xlemixx_) creates a Reply to Account 1's post
    const replyText = `Heyyyy`;
    console.log(
      `3️⃣ [Account 2: @${userL.username}] Creating reply container for post ${publishedPostId}...`,
    );
    console.log(`   Reply text: "${replyText}"`);

    const replyBody = new URLSearchParams({
      media_type: "TEXT",
      text: replyText,
      reply_to_id: publishedPostId,
      access_token: tokenL,
    });

    const replyContainer = await apiRequest<{ id: string }>(
      `${BASE_URL}/me/threads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: replyBody.toString(),
      },
    );
    console.log(
      `✅ Reply container created! Creation ID: ${replyContainer.id}`,
    );

    console.log("⏳ Waiting 15s for Meta to process the reply container...");
    await sleep(15000);

    const replyPublishBody = new URLSearchParams({
      creation_id: replyContainer.id,
      access_token: tokenL,
    });

    const publishedReply = await apiRequest<{ id: string }>(
      `${BASE_URL}/me/threads_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: replyPublishBody.toString(),
      },
    );
    publishedReplyId = publishedReply.id;
    console.log(
      `🎉 [Account 2: @${userL.username}] Reply published! Reply ID: ${publishedReplyId}\n`,
    );

    // 4. Verify the thread
    console.log("4️⃣ Verifying thread replies via API...");
    try {
      const threadReplies = await apiRequest<{
        data: Array<{ id: string; text: string; username: string }>;
      }>(`${BASE_URL}/${publishedPostId}/replies`, {
        method: "GET",
        params: { fields: "id,text,username", access_token: tokenV },
      });
      console.log(
        `✅ Confirmed! Post has ${threadReplies.data.length} reply/replies:`,
      );
      threadReplies.data.forEach((r) => {
        console.log(`   - @${r.username}: "${r.text}"`);
      });
    } catch (err) {
      console.log(
        "   (Replies endpoint check skipped:",
        (err as Error).message,
        ")",
      );
    }

    console.log("\n==================================================");
    console.log(`👉 Author profile: https://www.threads.net/@${userV.username}`);
    console.log(`👉 Replier profile: https://www.threads.net/@${userL.username}`);
    console.log(`👉 Post item ID: ${publishedPostId}`);
    console.log("==================================================");

    console.log("\n⏳ Pausing 5 seconds before self clean up...");
    await sleep(5000);
  } finally {
    // 5. Self Clean Up
    console.log("\n🧹 [Self Clean Up] Deleting created test post and reply...");
    if (publishedReplyId) {
      console.log(
        `   Deleting test reply ${publishedReplyId} using Replier token...`,
      );
      await deleteThreadsMedia(publishedReplyId, tokenL);
    }
    if (publishedPostId) {
      console.log(
        `   Deleting test root post ${publishedPostId} using Author token...`,
      );
      await deleteThreadsMedia(publishedPostId, tokenV);
    }
    console.log("✨ [Self Clean Up] Finished cleaning up test items.\n");
  }
}

main().catch((err) => {
  console.error("\n❌ Cross-Account Test Failed:", (err as Error).message);
  process.exit(1);
});
