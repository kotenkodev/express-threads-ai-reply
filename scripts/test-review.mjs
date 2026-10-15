import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const originalCwd = process.cwd();
const directory = mkdtempSync(join(tmpdir(), 'threads-review-'));
process.chdir(directory);
process.env.DRY_RUN = 'true';
const database = await import('../dist/db.js');
const { campaigns } = await import('../dist/config/campaigns.js');
const { createReviewRouter } = await import('../dist/services/review.js');
const { runPostingConsumerTick } = await import('../dist/workers/consumer.js');
const campaign = campaigns[0];
campaign.account.activeHoursStart = 0;
campaign.account.activeHoursEnd = 24;
let release;
let failGeneration = false;
const router = createReviewRouter(async () => {
  if (failGeneration) throw new Error('Simulated AI outage');
  await new Promise(resolve => { release = resolve; });
  return { isRelevant: true, confidenceScore: 99, reasoning: 'Match', replyText: 'Regenerated draft' };
});
const app = express();
app.use(express.json());
app.use('/api/review', router);
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}/api/review`;
const action = (id, name, replyText) => fetch(`${origin}/${id}/${name}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replyText }),
});
const seed = (id, status = 'QUEUED', created_at) => database.saveProcessedPost({
  post_id: id, campaign_id: campaign.id, username: id, post_text: 'Looking for help',
  reply_text: 'Original draft', ai_score: 99, status, created_at,
});
try {
  const root = origin.replace('/api/review', '');
  const html = await (await fetch(root)).text();
  assert.ok(html.includes('Matched posts') && html.includes('/review.js'));
  assert.equal((await fetch(`${root}/review.js`)).status, 200);
  assert.equal((await fetch(`${root}/review.css`)).status, 200);
  seed('review'); seed('skip', 'SKIPPED'); seed('sent', 'REPLIED'); seed('reject');
  assert.deepEqual((await (await fetch(origin)).json()).posts.map(p => p.post_id).sort(), ['reject', 'review']);
  assert.equal((await action('review', 'edit', '')).status, 400);
  assert.equal((await action('review', 'edit', 'https://example.com')).status, 400);
  assert.equal((await action('review', 'edit', 'Download now')).status, 400);
  assert.equal((await action('review', 'send', 'x'.repeat(401))).status, 400);
  assert.equal(database.getPost('review').status, 'QUEUED');
  assert.equal((await action('review', 'queue', 'Queued draft update')).status, 200);
  assert.equal(database.getPost('review').reply_text, 'Queued draft update');
  assert.equal(database.getPost('review').status, 'QUEUED');
  assert.equal((await action('review', 'edit', 'Edited draft')).status, 200);
  assert.equal(database.getPost('review').reply_text, 'Edited draft');
  assert.equal((await action('reject', 'reject')).status, 200);
  assert.equal(database.getPost('reject').status, 'REJECTED');
  assert.equal((await action('reject', 'send', 'No')).status, 409);
  const regenerating = action('review', 'regenerate');
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await action('review', 'send', 'No')).status, 409);
  assert.equal((await action('review', 'reject')).status, 409);
  release();
  assert.equal((await regenerating).status, 200);
  assert.equal(database.getPost('review').reply_text, 'Regenerated draft');
  failGeneration = true;
  assert.equal((await action('review', 'regenerate')).status, 500);
  assert.equal(database.getPost('review').reply_text, 'Regenerated draft');
  await runPostingConsumerTick(campaign);
  assert.equal(database.getPost('review').status, 'QUEUED', 'Automatic tick must not send');
  const sent = await action('review', 'send', 'Visible edited draft');
  assert.equal((await sent.json()).status, 'DRY_RUN');
  assert.equal(database.getPost('review').reply_text, 'Visible edited draft');
  assert.equal((await action('review', 'send', 'Duplicate')).status, 409);
  seed('expired', 'QUEUED', '2000-01-01T00:00:00Z');
  assert.equal((await action('expired', 'send', 'Old draft')).status, 409);
  assert.equal(database.getPost('expired').status, 'EXPIRED');
  seed('capped');
  campaign.account.dailyReplyLimit = 0;
  assert.equal((await action('capped', 'send', 'Limit')).status, 409);
  assert.equal(database.getPost('capped').status, 'QUEUED');
  assert.equal((await action('missing', 'edit', 'Nothing')).status, 404);
  console.log('Review integration checks passed (isolated SQLite, no external API calls).');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  database.sqlite.close();
  process.chdir(originalCwd);
  rmSync(directory, { recursive: true, force: true });
}
