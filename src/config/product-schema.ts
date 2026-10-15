import { z } from "zod";

const envVarRegex = /^[A-Z_][A-Z0-9_]*$/;

export const productSchema = z.object({
  version: z.number().int().default(1),
  key: z.string().min(1).regex(/^[a-z0-9][a-z0-9_-]*$/),
  active: z.boolean().default(true),
  product: z.object({
    label: z.string().min(1),
    homepage: z.string().url(),
    description: z.string().min(1),
    audience: z.string().min(1),
    strengths: z.array(z.string().min(1)).default([]),
  }).strict(),
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
  }).strict(),
  writing: z.object({
    locale: z.string().default("match-post"),
    voice: z.string().default("Friendly, helpful and concise; no hard sell."),
    guidance: z.string().default(""),
    characterBudget: z.number().int().min(1).max(500).default(400),
    permitLinks: z.boolean().default(false),
    forbiddenWording: z.array(z.string()).default(["download now", "use my code", "link in bio"]),
  }).strict().default({
    locale: "match-post",
    voice: "Friendly, helpful and concise; no hard sell.",
    guidance: "",
    characterBudget: 400,
    permitLinks: false,
    forbiddenWording: ["download now", "use my code", "link in bio"],
  }),
  publishing: z.object({
    credentialVariable: z.string().regex(envVarRegex, "Must be a valid environment variable name").default("THREADS_ACCESS_TOKEN"),
    userId: z.string().default("me"),
    dailyBudget: z.number().int().min(0).max(1000).default(20),
    window: z.object({
      fromHour: z.number().int().min(0).max(23).default(9),
      untilHour: z.number().int().min(0).max(24).default(22),
      timeZone: z.string().refine((tz) => {
        try {
          new Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, { message: "Invalid IANA timezone" }).default("Europe/Kyiv"),
    }).strict().refine((w) => w.fromHour !== w.untilHour, {
      message: "fromHour and untilHour cannot be the same",
      path: ["untilHour"],
    }).default({
      fromHour: 9,
      untilHour: 22,
      timeZone: "Europe/Kyiv",
    }),
  }).strict().default({
    credentialVariable: "THREADS_ACCESS_TOKEN",
    userId: "me",
    dailyBudget: 20,
    window: {
      fromHour: 9,
      untilHour: 22,
      timeZone: "Europe/Kyiv",
    },
  }),
  generation: z.object({
    model: z.string().optional(),
    endpoint: z.string().url().optional(),
    credentialVariable: z.string().regex(envVarRegex).optional(),
    temperature: z.number().min(0).max(2).default(0.7),
  }).strict().default({
    temperature: 0.7,
  }),
}).strict();

export type ProductProfile = z.infer<typeof productSchema>;
