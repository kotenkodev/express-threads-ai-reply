import { Router, Request, Response } from "express";
import { campaigns, getCampaigns } from "../config/campaigns.js";
import {
  getPost,
  getMatchedPosts,
  getPendingPosts,
  updatePostDraft,
  markPostReplied,
  markPostIgnored,
  updatePostStatus,
  buildThreadsReplyIntentUrl,
} from "../db.js";
import { evaluatePostAndGenerateReply } from "./ai.js";
import { replyPolicyError } from "./reply-policy.js";
import { productsRouter } from "./products-router.js";

function createReviewRouter(generate = evaluatePostAndGenerateReply) {
  const router = Router();
  const busyPosts = new Set<string>();

  // Products and keywords management
  router.use("/products", productsRouter);

  // Fetch pending review posts
  router.get("/", (_req, res) => {
    const currentCampaigns = getCampaigns();
    const posts = (getPendingPosts ? getPendingPosts() : getMatchedPosts()).map((post) => {
      const campaign = currentCampaigns.find((c) => c.id === post.campaign_id);
      const shortcode = post.shortcode || (post.permalink ? post.permalink.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] : undefined);
      const replyText = post.reply_text || post.aiDraftReply || "";
      const intentUrl =
        post.intent_url ||
        (replyText && (shortcode || post.permalink)
          ? buildThreadsReplyIntentUrl(shortcode || post.permalink!, replyText)
          : null);

      return {
        ...post,
        shortcode: shortcode ?? null,
        relevanceScore: post.ai_score ?? null,
        aiDraftReply: post.reply_text ?? null,
        intent_url: intentUrl,
        productName: campaign?.productName || post.campaign_id,
        characterBudget: campaign?.writing?.characterBudget ?? 500,
      };
    });

    res.set("Cache-Control", "no-store").json({
      posts,
      products: currentCampaigns.map((c) => ({
        id: c.id,
        name: c.enabled ? c.productName : `${c.productName} (paused)`,
        enabled: c.enabled,
      })),
    });
  });

  // Core action processor with concurrency lock per post
  async function handlePostAction(id: string, action: string, req: Request, res: Response) {
    if (!["reject", "ignore", "edit", "regenerate", "send", "replied", "queue"].includes(action)) {
      return res.status(404).json({ error: "Unknown review action" });
    }

    const post = getPost(id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (busyPosts.has(id)) {
      return res.status(409).json({ error: "Post is currently busy with another action." });
    }

    const campaign = getCampaigns().find((c) => c.id === post.campaign_id);
    if (action !== "reject" && action !== "ignore" && !campaign) {
      return res.status(409).json({ error: "This campaign does not exist." });
    }

    if (action === "edit" || action === "send" || action === "queue") {
      const replyText = String(req.body?.replyText ?? "").trim();
      if (!replyText) {
        return res.status(400).json({ error: "Reply text cannot be empty." });
      }
      if (campaign) {
        const error = replyPolicyError(replyText, campaign);
        if (error) return res.status(400).json({ error });
      }
    }

    busyPosts.add(id);
    try {
      if (action === "reject" || action === "ignore") {
        markPostIgnored(id);
        updatePostStatus(id, "IGNORED");
        return res.json({ success: true, message: "Post ignored." });
      }

      if (action === "edit" || action === "queue") {
        const replyText = String(req.body.replyText).trim();
        updatePostDraft(id, replyText);
        return res.json({ success: true, post: getPost(id), message: "Draft saved." });
      }

      if (action === "replied") {
        markPostReplied(id, req.body?.replyId);
        return res.json({ success: true, message: "Marked as replied." });
      }

      if (action === "send") {
        // Human-in-the-loop: mark as replied and return the intent URL
        if (req.body?.replyText) {
          updatePostDraft(id, String(req.body.replyText).trim());
        }
        markPostReplied(id);
        const updated = getPost(id);
        return res.json({
          success: true,
          status: "REPLIED",
          message: "Marked as replied via Threads Web Intent.",
          intentUrl: updated?.intent_url,
        });
      }

      if (action === "regenerate") {
        const result = await generate(
          post.post_text,
          post.username,
          campaign!,
          post.reply_text || ""
        );
        if (
          !result.isRelevant ||
          result.confidenceScore < campaign!.minConfidenceScore ||
          replyPolicyError(result.replyText, campaign!)
        ) {
          return res.status(422).json({
            error: "AI did not produce a suitable replacement. Your existing draft is unchanged.",
          });
        }
        updatePostDraft(id, result.replyText.trim());
        return res.json({
          success: true,
          post: getPost(id),
          message: "New response generated. Review it before opening in Threads.",
        });
      }
    } catch (error) {
      console.error("[Review action error]", error);
      return res.status(500).json({ error: (error as Error).message });
    } finally {
      busyPosts.delete(id);
    }
  }

  // Explicit endpoints delegate to handlePostAction for unified concurrency & behavior
  router.post("/:id/replied", (req, res) => handlePostAction(String(req.params.id), "replied", req, res));
  router.post("/:id/ignore", (req, res) => handlePostAction(String(req.params.id), "ignore", req, res));
  router.post("/:id/edit", (req, res) => handlePostAction(String(req.params.id), "edit", req, res));
  router.post("/:id/regenerate", (req, res) => handlePostAction(String(req.params.id), "regenerate", req, res));
  router.post("/:id/:action", (req, res) => handlePostAction(String(req.params.id), String(req.params.action), req, res));

  return router;
}

export const reviewRouter = createReviewRouter();
