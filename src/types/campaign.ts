export interface CampaignAccountConfig {
  threadsUserId: string; // or "me"
  accessTokenEnvVar: string; // e.g., "THREADS_ACCESS_TOKEN"
  dailyReplyLimit: number; // e.g., 20
  activeHoursStart: number; // e.g., 9 (9 AM)
  activeHoursEnd: number; // e.g., 22 (10 PM)
  minDelaySeconds: number; // e.g., 180
  maxDelaySeconds: number; // e.g., 600
  timeZone?: string;
}

export interface CampaignConfig {
  id: string;
  enabled: boolean;
  productName: string;
  productUrl: string;
  productContext: string; // What the product does, target audience, pain points solved
  replyGuidelines: string; // Tone of voice, how to mention the link/brand
  keywords: string[];
  minConfidenceScore: number; // e.g., 75
  maxPostAgeMinutes: number; // e.g., 240
  account: CampaignAccountConfig;
  sourceProvider?: "threads_api" | "scraper" | "mock";
  searchType?: "RECENT" | "TOP";
  inspectPerRun?: number;
  draftsPerRun?: number;
  excludeText?: string[];
  excludeHandles?: string[];
  ownHandle?: string;
  writing?: {
    locale: string;
    characterBudget: number;
    permitLinks: boolean;
    forbiddenWording: string[];
  };
  generation?: {
    model?: string;
    endpoint?: string;
    credentialVariable?: string;
    temperature: number;
  };
}
