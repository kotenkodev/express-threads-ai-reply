import { z } from "zod";

export const productSchema = z.object({
  version: z.number().int().default(1),
  key: z.string().min(1),
  active: z.boolean().default(true),
  product: z.object({
    label: z.string().min(1),
    homepage: z.string().url(),
    description: z.string().min(1),
    audience: z.string().min(1),
    strengths: z.array(z.string().min(1)).default([]),
  }),
  listening: z.object({
    phrases: z.array(z.string().min(1)).min(1),
    intent: z.string().min(1).default("People actively seeking help with the product's use cases."),
    ordering: z.enum(["RECENT", "TOP"]).default("RECENT"),
    freshnessMinutes: z.number().int().min(1).max(43200).default(7200),
    reviewThreshold: z.number().int().min(0).max(100).default(75),
    inspectPerRun: z.number().int().min(1).max(100).default(25),
    draftsPerRun: z.number().int().min(1).max(100).default(5),
    skipText: z.array(z.string()).default([]),
    skipHandles: z.array(z.string()).default([]),
    ownHandle: z.string().default(""),
    provider: z.string().default("scraper"),
  }),
  writing: z.object({
    locale: z.string().default("match-post"),
    voice: z.string().default("Friendly, helpful and concise; no hard sell."),
    guidance: z.string().default(""),
    characterBudget: z.number().int().min(1).max(500).default(400),
    permitLinks: z.boolean().default(false),
    forbiddenWording: z.array(z.string()).default(["download now", "use my code", "link in bio"]),
  }).default({
    locale: "match-post",
    voice: "Friendly, helpful and concise; no hard sell.",
    guidance: "",
    characterBudget: 400,
    permitLinks: false,
    forbiddenWording: ["download now", "use my code", "link in bio"],
  }),
  publishing: z.object({
    credentialVariable: z.string().optional(),
    userId: z.string().optional(),
    dailyBudget: z.number().int().optional(),
    window: z.object({
      fromHour: z.number().int().optional(),
      untilHour: z.number().int().optional(),
      timeZone: z.string().optional(),
    }).optional(),
  }).optional(),
  generation: z.object({
    model: z.string().optional(),
    endpoint: z.string().url().optional(),
    credentialVariable: z.string().optional(),
    temperature: z.number().min(0).max(2).default(0.7),
  }).optional().default({
    temperature: 0.7,
  }),
}).passthrough();

export type ProductProfile = z.infer<typeof productSchema>;
