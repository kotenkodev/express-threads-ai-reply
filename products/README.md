# Product files

Put one or more `.json` files directly in this directory. Each file may contain
one product object or an array of product objects. Every `key` must be unique,
including disabled products. Files load alphabetically at startup; restart after changes.
Use `PRODUCTS_DIR` in `.env` to choose another directory.

Copy `examples/briefgarden.json` here, replace its fictional details, choose a
new key, and set `active` to `true`. The examples subdirectory is not loaded.
`yollly.json` is the active breakfast-app campaign. It uses the existing
`THREADS_ACCESS_TOKEN` credential and excludes the existing publishing handle
`vorgyn`; update `publishing.credentialVariable` and `listening.ownHandle` if
you connect a different account.

The schema is defined with Joi in `src/config/product-schema.ts`. Unknown fields,
wrong types, duplicate keys, invalid URLs, and invalid timezones stop startup
with a filename and field path. JSON numbers and booleans must use native JSON
types, not strings. Optional sections and fields receive the defaults below.

| Section | Settings and behavior |
| --- | --- |
| `version`, `key`, `active` | Version `1`; required stable lowercase key; active defaults to `true`. Keep keys stable so saved drafts retain their product association. |
| `product` | Required `label`, `homepage`, `description`, and `audience`; optional `strengths` array. These facts guide AI evaluation and generation. |
| `listening.phrases` | Required nonempty list. One phrase is searched per product per sourcing run, rotating in order. |
| `listening.intent` | Describes suitable conversations for AI relevance evaluation. |
| `listening.ordering` | `RECENT` (default) or `TOP`. |
| `listening.freshnessMinutes` | Maximum post age at discovery and maximum time in the queue; default `240`, range `1–43200`. |
| `listening.reviewThreshold` | Required AI confidence on a `0–100` scale; default `75`. |
| `listening.inspectPerRun` | Maximum posts examined from the returned search page, default `25`, range `1–100`. This does not fetch extra pages. |
| `listening.draftsPerRun` | Stop after this many accepted drafts for this product, default `5`, range `1–100`. |
| `listening.skipText`, `skipHandles` | Case-insensitive text substrings and exact author handles to exclude before AI calls. Handles may include `@`. |
| `listening.ownHandle` | Your publishing account's username to exclude. Falls back to `THREADS_BOT_USERNAME`. |
| `writing.locale` | `match-post` (default) or a language instruction such as `en` or `uk`. Applied to the AI prompt. |
| `writing.voice`, `guidance` | Tone and additional instructions for evaluation and regeneration. |
| `writing.characterBudget` | Unicode code-point limit, default `400`, maximum `500`. Enforced on generated, edited, and sent replies. |
| `writing.permitLinks` | Default `false`; blocks URLs and domain-like text. `true` permits links but does not require them. |
| `writing.forbiddenWording` | Case-insensitive substring exclusions for drafts and sending. Default: `download now`, `use my code`, `link in bio`. |
| `publishing.credentialVariable` | Required name of a Threads token variable in `.env`, never the token itself. |
| `publishing.userId` | Threads user ID or `me` (default). |
| `publishing.dailyBudget` | Per-product daily cap, default `20`; `0` blocks sending. Existing counters use the stored record creation date in UTC. |
| `publishing.window` | `fromHour` (`9`), `untilHour` (`22`), `timeZone` (`Europe/Kyiv`). Start inclusive, end exclusive. Overnight ranges work; `0–24` allows all day. |
| `generation` | Optional `model`, `endpoint`, `credentialVariable`, and `temperature` (`0.7`, range `0–2`). Uses the existing OpenAI-compatible Chat Completions client. Omitted values inherit the `OPENAI_*` environment settings. Choose a model supporting JSON responses and temperature. |

Example `.env` entries for separate products:

```dotenv
THREADS_TOKEN_BRIEFGARDEN=your_threads_token
THREADS_TOKEN_SECOND_PRODUCT=another_threads_token
```

Review stays in the web dashboard. Select a product to filter drafts and run its
search. Nothing publishes automatically. `DRY_RUN` applies to every product.
Language and tone are AI instructions; length, forbidden wording, and link rules
are also checked by the server.

The existing database globally deduplicates post IDs across products: a post
already recorded for one product is not processed again by another. Use distinct
search phrases for separate audiences. Daily budgets are per product, so when
sharing an account choose budgets that fit your total account allowance.

This schema intentionally covers implemented behavior: there is no AI query
planner, Telegram approval, native Anthropic client, or similarity-scoring setting.
