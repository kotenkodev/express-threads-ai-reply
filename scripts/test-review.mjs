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
const campaign = campaigns[0];

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

const seed = (id, status = 'PENDING', created_at, shortcode = `code_${id}`) => database.saveProcessedPost({
  post_id: id,
  shortcode,
  campaign_id: campaign.id,
  username: id,
  post_text: 'Looking for help with routine',
  reply_text: 'Original draft suggestion',
  ai_score: 99,
  status,
  created_at,
});

try {
  const root = origin.replace('/api/review', '');
  const html = await (await fetch(root)).text();
  assert.ok(html.includes('Matched Posts') && html.includes('/review.js'));
  assert.equal((await fetch(`${root}/review.js`)).status, 200);
  assert.equal((await fetch(`${root}/review.css`)).status, 200);

  // Seed test records
  seed('review');
  seed('skip', 'SKIPPED');
  seed('sent', 'REPLIED');
  seed('reject');

  // Verify matched posts in queue
  const matchedList = (await (await fetch(origin)).json()).posts.map(p => p.post_id).sort();
  assert.deepEqual(matchedList, ['reject', 'review']);

  // Policy validation
  assert.equal((await action('review', 'edit', '')).status, 400);
  assert.equal((await action('review', 'edit', 'https://example.com')).status, 400);
  assert.equal((await action('review', 'edit', 'Download now')).status, 400);

  // Edit draft
  assert.equal((await action('review', 'edit', 'Edited draft text')).status, 200);
  assert.equal(database.getPost('review').reply_text, 'Edited draft text');
  assert.ok(database.getPost('review').intent_url?.includes('reply_post_shortcode=code_review'));

  // Reject / Ignore
  assert.equal((await action('reject', 'reject')).status, 200);
  assert.equal(database.getPost('reject').status, 'IGNORED');

  // Concurrent lock during regeneration
  const regenerating = action('review', 'regenerate');
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await action('review', 'reject')).status, 409);
  release();
  assert.equal((await regenerating).status, 200);
  assert.equal(database.getPost('review').reply_text, 'Regenerated draft');

  // Failing AI generation preserves existing draft
  failGeneration = true;
  assert.equal((await action('review', 'regenerate')).status, 500);
  assert.equal(database.getPost('review').reply_text, 'Regenerated draft');

  // Mark as replied via Web Intent action
  const repliedRes = await action('review', 'replied');
  assert.equal(repliedRes.status, 200);
  assert.equal(database.getPost('review').status, 'REPLIED');

  // 404 for nonexistent post
  assert.equal((await action('missing', 'edit', 'Nothing')).status, 404);

  console.log('Human-in-the-Loop Web Intent review checks passed (isolated SQLite, no external API calls).');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  try {
    const repo = database.getDatabaseRepository?.();
    repo?.getSqliteHandle?.()?.close();
  } catch {}
  process.chdir(originalCwd);
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {}
}
