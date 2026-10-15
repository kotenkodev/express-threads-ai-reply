import type { PostSourceProvider, PostSourceQuery, PostSourceResult } from "../../types/provider.js";
import { searchKeywordPosts } from "./client.js";
import { readCredential } from "../../config/env.js";

export class MetaThreadsPostSource implements PostSourceProvider {
  readonly name = "threads_api";

  async searchPosts(query: PostSourceQuery): Promise<PostSourceResult[]> {
    const { campaign, keyword, searchType = "RECENT" } = query;
    const tokenEnvVar = campaign.account.accessTokenEnvVar;
    const accessToken = readCredential(tokenEnvVar);

    if (!accessToken) {
      throw new Error(`Missing required Threads access token in env var: ${tokenEnvVar}`);
    }

    const posts = await searchKeywordPosts(keyword, accessToken, searchType);

    return posts.map((post) => ({
      id: post.id,
      text: post.text || "",
      username: post.username,
      permalink:
        post.permalink ||
        (post.shortcode
          ? `https://www.threads.com/@${post.username}/post/${post.shortcode}`
          : `https://www.threads.com/@${post.username}`),
      timestamp: post.timestamp,
      isReply: Boolean(post.is_reply),
      isQuotePost: Boolean(post.is_quote_post),
      hasReplies: Boolean(post.has_replies),
      mediaType: post.media_type,
      raw: post,
    }));
  }
}

