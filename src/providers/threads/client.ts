import axios from "axios";
import type {
  KeywordSearchResponse,
  CreateContainerResponse,
  PublishContainerResponse,
  PublishingLimitResponse,
  ThreadsPost,
} from "../../types/threads.js";

const THREADS_API_BASE_URL = "https://graph.threads.net/v1.0";

export function formatAxiosError(prefix: string, error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data =
      typeof error.response?.data === "object"
        ? JSON.stringify(error.response.data)
        : error.response?.data;
    return new Error(`${prefix} [HTTP ${status || "unknown"}]: ${data || error.message}`);
  }
  return error instanceof Error ? error : new Error(`${prefix}: ${String(error)}`);
}

/**
 * Searches recent Threads posts by keyword using official Meta Threads Keyword Search endpoint.
 */
export async function searchKeywordPosts(
  keyword: string,
  accessToken: string,
  searchType: "RECENT" | "TOP" = "RECENT"
): Promise<ThreadsPost[]> {
  try {
    const res = await axios.get<KeywordSearchResponse>(`${THREADS_API_BASE_URL}/keyword_search`, {
      params: {
        q: keyword,
        search_type: searchType,
        search_mode: "KEYWORD",
        fields: "id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply,shortcode,media_product_type,owner,topic_tag",
        access_token: accessToken,
      },
      headers: {
        Accept: "application/json",
      },
    });

    return res.data?.data || [];
  } catch (error) {
    throw formatAxiosError("Threads API search failed", error);
  }
}

/**
 * Step 1: Create a Reply Media Container on Threads.
 */
export async function createReplyContainer(
  userId: string = "me",
  targetPostId: string,
  replyText: string,
  accessToken: string
): Promise<string> {
  const url = `${THREADS_API_BASE_URL}/${encodeURIComponent(userId)}/threads`;

  const body = new URLSearchParams({
    media_type: "TEXT",
    text: replyText,
    reply_to_id: targetPostId,
    access_token: accessToken,
  });

  try {
    const res = await axios.post<CreateContainerResponse>(url, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
    });

    if (!res.data?.id) {
      throw new Error(`Threads API returned no container ID: ${JSON.stringify(res.data)}`);
    }

    return res.data.id;
  } catch (error) {
    throw formatAxiosError("Threads API create reply container failed", error);
  }
}

/**
 * Step 2: Publish a previously created container.
 */
export async function publishReplyContainer(
  userId: string = "me",
  creationId: string,
  accessToken: string
): Promise<string> {
  const url = `${THREADS_API_BASE_URL}/${encodeURIComponent(userId)}/threads_publish`;

  const body = new URLSearchParams({
    creation_id: creationId,
    access_token: accessToken,
  });

  try {
    const res = await axios.post<PublishContainerResponse>(url, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
    });

    if (!res.data?.id) {
      throw new Error(`Threads API returned no published ID: ${JSON.stringify(res.data)}`);
    }

    return res.data.id;
  } catch (error) {
    throw formatAxiosError("Threads API publish container failed", error);
  }
}

/**
 * High-level 2-step publish flow with official container processing wait time (15s-30s).
 */
export async function publishReplyWithWait(
  userId: string = "me",
  targetPostId: string,
  replyText: string,
  accessToken: string,
  waitMs: number = 20000
): Promise<string> {
  const creationId = await createReplyContainer(userId, targetPostId, replyText, accessToken);

  // Meta Threads docs suggest waiting 15–30s for the media container to finish processing
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const publishedId = await publishReplyContainer(userId, creationId, accessToken);
  return publishedId;
}

/**
 * Checks Threads publishing quota limits.
 */
export async function checkPublishingLimit(
  userId: string = "me",
  accessToken: string
): Promise<PublishingLimitResponse | null> {
  try {
    const url = `${THREADS_API_BASE_URL}/${encodeURIComponent(userId)}/threads_publishing_limit`;
    const res = await axios.get<PublishingLimitResponse>(url, {
      params: {
        fields: "quota_usage,config,reply_quota_usage,reply_config",
        access_token: accessToken,
      },
      headers: {
        Accept: "application/json",
      },
    });

    return res.data;
  } catch {
    return null;
  }
}

