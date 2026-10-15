import type { CampaignConfig } from "../types/campaign.js";

/**
 * Validates that reply content adheres to the product's safety rules and anti-spam constraints:
 * - Character count within budget (default 400-500)
 * - Prohibits URLs/domain names when permitLinks is false (essential to prevent shadowbans on Threads)
 * - Prohibits spammy marketing buzzwords (forbidden wording)
 */
export function replyPolicyError(text: unknown, campaign: CampaignConfig): string | undefined {
  const max = campaign.writing?.characterBudget ?? 500;
  if (typeof text !== "string" || !text.trim() || Array.from(text.trim()).length > max) {
    return `Reply must contain 1–${max} characters.`;
  }
  if (
    campaign.writing?.permitLinks === false &&
    /(?:https?:\/\/|www\.|\b[\p{L}\d-]+\.(?:[a-z]{2,})(?:\b|\/))/iu.test(text)
  ) {
    return "This product does not allow links or domain names in replies.";
  }
  const banned = campaign.writing?.forbiddenWording?.find((phrase) =>
    text.toLocaleLowerCase().includes(phrase.toLocaleLowerCase())
  );
  if (banned) return `This product does not allow the phrase: ${banned}`;
}

/**
 * Checks whether a post should be excluded from sourcing/commenting based on:
 * - Forbidden stop words/hashtags (#ad, sponsored, etc.)
 * - Excluded competitor/bot handles
 * - The campaign's own handle (prevent replying to self)
 */
export function excludedPost(text: string, username: string, campaign: CampaignConfig): boolean {
  const handle = username.replace(/^@/, "").toLowerCase();
  
  if (campaign.ownHandle && campaign.ownHandle.replace(/^@/, "").toLowerCase() === handle) {
    return true;
  }

  const matchesExcludedText = campaign.excludeText?.some((term) =>
    text.toLowerCase().includes(term.toLowerCase())
  );
  const matchesExcludedHandle = campaign.excludeHandles?.some(
    (author) => author.replace(/^@/, "").toLowerCase() === handle
  );

  return Boolean(matchesExcludedText || matchesExcludedHandle);
}

