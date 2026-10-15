/**
 * Generates the official Threads Web Intent URL for 1-click prefilled replies.
 * URL format: https://www.threads.com/intent/post?reply_post_shortcode={SHORTCODE}&text={URL_ENCODED_TEXT}
 */
export function buildThreadsReplyIntentUrl(postShortcodeOrUrl: string, replyText: string): string {
  // If a full URL is passed (e.g., https://www.threads.com/@user/post/DRM8DF9AGUc), extract the shortcode
  const shortcodeMatch = postShortcodeOrUrl.match(/\/post\/([A-Za-z0-9_-]+)/);
  const shortcode = shortcodeMatch ? shortcodeMatch[1] : postShortcodeOrUrl.trim();

  const params = new URLSearchParams({
    reply_post_shortcode: shortcode,
    text: replyText.trim(),
  });

  return `https://www.threads.com/intent/post?${params.toString()}`;
}
