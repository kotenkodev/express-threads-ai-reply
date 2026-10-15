import type { PostSourceProvider, PostSourceQuery, PostSourceResult } from "../../types/provider.js";

export class MockPostSource implements PostSourceProvider {
  readonly name = "mock";

  async searchPosts(query: PostSourceQuery): Promise<PostSourceResult[]> {
    const { keyword } = query;
    const timestamp = new Date().toISOString();
    const seed = Date.now().toString().slice(-4);

    const shortcode1 = `Deg${seed}A1`;
    const shortcode2 = `Deg${seed}B2`;
    const shortcode3 = `Deg${seed}C3`;

    return [
      {
        id: `mock_post_en_${seed}_1`,
        shortcode: shortcode1,
        text: `Honestly struggling with ${keyword} right now. I spend way too much time staring at a blank screen trying to figure out what to write and reply to people. Any recommendations or tools that actually help creators stay consistent without burning out?`,
        username: `creator_alex_${seed}`,
        permalink: `https://www.threads.com/@creator_alex_${seed}/post/${shortcode1}`,
        timestamp,
        isReply: false,
        isQuotePost: false,
        hasReplies: false,
        mediaType: "TEXT_POST",
      },
      {
        id: `mock_post_ua_${seed}_2`,
        shortcode: shortcode2,
        text: `Хто як автоматизує роботу з соцмережами та ${keyword}? Потрібен нормальний інструмент або підхід, щоб не витрачати по 3 години щодня на пошук тем і коментування вручну.`,
        username: `indie_dan_${seed}`,
        permalink: `https://www.threads.com/@indie_dan_${seed}/post/${shortcode2}`,
        timestamp,
        isReply: false,
        isQuotePost: false,
        hasReplies: false,
        mediaType: "TEXT_POST",
      },
      {
        id: `mock_post_irrelevant_${seed}_3`,
        shortcode: shortcode3,
        text: `Just made the best homemade pizza ever, Friday night movie marathon starting now! 🍕🎬`,
        username: `random_user_${seed}`,
        permalink: `https://www.threads.com/@random_user_${seed}/post/${shortcode3}`,
        timestamp,
        isReply: false,
        isQuotePost: false,
        hasReplies: false,
        mediaType: "TEXT_POST",
      },
    ];
  }
}
