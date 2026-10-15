import axios from "axios";
import { env, readCredential } from "../config/env.js";
import { Router } from "express";
import { campaigns } from "../config/campaigns.js";
import {
  getPost,
  getMatchedPosts,
  editQueuedPost,
  updatePostStatus,
  saveProcessedPost,
} from "../db.js";
import { evaluatePostAndGenerateReply } from "./ai.js";
import { runPostingConsumerTick } from "../workers/consumer.js";
import { replyPolicyError } from "./reply-policy.js";

export function createReviewRouter(generate = evaluatePostAndGenerateReply) {
  const router = Router();
  const busyPosts = new Set<string>();
  // Serialize sends across campaigns: their tokens may belong to the same account.
  let sending = false;

  router.get("/", (_req, res) => {
    res.set("Cache-Control", "no-store").json({
      posts: getMatchedPosts().map((post) => {
        const campaign = campaigns.find((c) => c.id === post.campaign_id);
        return {
          ...post,
          productName: campaign?.productName || post.campaign_id,
          characterBudget: campaign?.writing?.characterBudget ?? 500,
        };
      }),
      dryRun: env.DRY_RUN,
      products: campaigns
        .filter((c) => c.enabled)
        .map((c) => ({ id: c.id, name: c.productName })),
    });
  });

  router.post("/import-my-post", async (_req, res) => {
    const token = readCredential("THREADS_ACCESS_TOKEN");
    if (!token) {
      return res.status(400).json({ error: "Threads account is not connected. Connect Threads first." });
    }

    try {
      const resp = await axios.get<{
        data: Array<{
          id: string;
          text?: string;
          permalink?: string;
          username?: string;
          timestamp?: string;
        }>;
      }>("https://graph.threads.net/v1.0/me/threads", {
        params: {
          fields: "id,text,permalink,timestamp,username",
          limit: 5,
          access_token: token,
        },
        timeout: 10000,
      });

      const items = resp.data?.data || [];
      if (!items.length) {
        return res.status(404).json({
          error: "No posts found on your connected Threads account. Create a post on Threads first!",
        });
      }

      const target = items[0];
      const campaign = campaigns.find((c) => c.enabled) || campaigns[0];
      const text = target.text || "Live test post from Threads";
      const username = target.username || "me";

      const evalResult = await generate(text, username, campaign);
      const replyText = evalResult.replyText || "Смачного сніданку!";

      saveProcessedPost({
        post_id: target.id,
        campaign_id: campaign.id,
        username,
        post_text: text,
        permalink: target.permalink || `https://www.threads.com/@${username}`,
        reply_text: replyText,
        ai_score: evalResult.confidenceScore || 95,
        ai_reasoning: evalResult.reasoning || "Real post from connected Threads account",
        status: "QUEUED",
      });

      return res.json({
        success: true,
        message: `Imported your real Threads post (ID: ${target.id}) into the review queue!`,
        postId: target.id,
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post("/:id/:action", async (req, res) => {
    const id = String(req.params.id);
    const action = String(req.params.action);
    if (!["reject", "edit", "regenerate", "send", "queue"].includes(action)) {
      return res.status(404).json({ error: "Unknown review action" });
    }
    const post = getPost(id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.status !== "QUEUED" || busyPosts.has(id)) {
      return res.status(409).json({
        error:
          "Post is no longer available for review or has an action in progress. Refresh the queue.",
      });
    }
    if (action === "send" && sending) {
      return res
        .status(409)
        .json({ error: "Another reply is being sent. Please wait." });
    }
    const campaign = campaigns.find(
      (c) => c.id === post.campaign_id && c.enabled,
    );
    if (action !== "reject" && !campaign)
      return res
        .status(409)
        .json({ error: "This product is disabled or no longer exists." });
    if (action === "edit" || action === "send" || action === "queue") {
      const error = replyPolicyError(req.body?.replyText, campaign!);
      if (error) return res.status(400).json({ error });
    }
    busyPosts.add(id);
    if (action === "send") sending = true;
    try {
      if (action === "reject") {
        updatePostStatus(id, "REJECTED");
        return res.json({ message: "Post rejected." });
      }
      if (action === "edit") {
        editQueuedPost(id, req.body.replyText.trim());
        return res.json({ post: getPost(id), message: "Draft saved." });
      }
      if (action === "queue") {
        editQueuedPost(id, req.body.replyText.trim());
        return res.json({
          post: getPost(id),
          message: "Reply saved and queued for scheduled posting.",
          status: "QUEUED",
        });
      }
      if (!campaign)
        return res
          .status(409)
          .json({ error: "This campaign is disabled or no longer exists." });
      if (action === "regenerate") {
        const result = await generate(
          post.post_text,
          post.username,
          campaign,
          post.reply_text || "",
        );
        if (
          !result.isRelevant ||
          result.confidenceScore < campaign.minConfidenceScore ||
          replyPolicyError(result.replyText, campaign)
        ) {
          return res.status(422).json({
            error:
              "AI did not produce a suitable replacement. Your existing draft is unchanged.",
          });
        }
        if (!editQueuedPost(id, result.replyText.trim())) {
          return res
            .status(409)
            .json({ error: "Post is no longer available for editing." });
        }
        return res.json({
          post: getPost(id),
          message: "New response generated. Review it before sending.",
        });
      }
      editQueuedPost(id, req.body.replyText.trim());
      const forceLive = req.body?.live === true || req.query?.live === "true";
      const result = await runPostingConsumerTick(campaign, id, { forceLive });
      if (result.status !== "REPLIED" && result.status !== "DRY_RUN") {
        return res.status(409).json({
          error: result.error || `Cannot send: ${result.status}`,
          status: result.status,
        });
      }
      return res.json({
        message:
          result.status === "DRY_RUN"
            ? "Dry run completed. Nothing was published."
            : "Reply sent to Threads!",
        status: result.status,
        replyId: result.replyId,
      });
    } catch (error) {
      console.error("[Review action]", error);
      return res.status(500).json({
        error:
          "Action failed. Your saved draft is retained. Check server logs before retrying.",
      });
    } finally {
      busyPosts.delete(id);
      if (action === "send") sending = false;
    }
  });
  return router;
}

export const reviewRouter = createReviewRouter();

