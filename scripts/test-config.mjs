import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseProduct, loadProducts } from '../dist/config/product-loader.js';
import { parseEnvironment } from '../dist/config/env.js';
import { replyPolicyError, excludedPost } from '../dist/services/reply-policy.js';

const minimal = {
  key: 'test-product',
  product: { label: 'Test', homepage: 'https://example.com', description: 'A useful tool', audience: 'Creators' },
  listening: { phrases: ['help with writing'] },
  publishing: { credentialVariable: 'THREADS_TOKEN_TEST' },
};
const product = parseProduct(minimal);
assert.equal(product.writing.characterBudget, 400);
assert.equal(product.generation.temperature, 0.7);
assert.equal(product.account.timeZone, 'Europe/Kyiv');
assert.equal(product.enabled, true);
assert.throws(() => parseProduct({ ...minimal, active: 'false' }), /active/);
assert.throws(() => parseProduct({ ...minimal, unsupported: true }), /unsupported/);
assert.throws(() => parseProduct({ ...minimal, listening: { phrases: [] } }), /phrases/);
assert.throws(() => parseProduct({ ...minimal, writing: { characterBudget: 501 } }), /characterBudget/);
assert.throws(() => parseProduct({ ...minimal, publishing: { credentialVariable: 'TOKEN', window: { timeZone: 'Bad/Zone' } } }), /timeZone/);
assert.throws(() => parseProduct({ ...minimal, publishing: { credentialVariable: 'TOKEN', window: { fromHour: 10, untilHour: 10 } } }), /untilHour/);
assert.throws(() => parseProduct({ ...minimal, publishing: { credentialVariable: 'secret-token-value' } }), error => !error.message.includes('secret-token-value'));
assert.throws(() => parseEnvironment({ PORT: 'no', DRY_RUN: 'not-a-boolean' }), error => error.message.includes('PORT') && error.message.includes('DRY_RUN'));
assert.throws(() => parseEnvironment({ CRON_SCHEDULE: 'not cron' }), /CRON_SCHEDULE/);
assert.throws(() => parseEnvironment({ OPENAI_BASE_URL: 'https://user:secret@example.com' }), error => !error.message.includes('secret'));
const env = parseEnvironment({ PORT: '3200', DRY_RUN: 'false', USE_MOCK_POSTS: 'true', OPENAI_BASE_URL: '' });
assert.equal(env.PORT, 3200);
assert.equal(env.DRY_RUN, false);
assert.equal(env.USE_MOCK_POSTS, true);
assert.equal(env.OPENAI_BASE_URL, undefined);
assert.equal(parseEnvironment({}).DRY_RUN, true);
assert.ok(replyPolicyError('Visit https://example.com', product));
assert.ok(replyPolicyError('DOWNLOAD NOW', product));
assert.ok(replyPolicyError('x'.repeat(401), product));
assert.equal(replyPolicyError('😀'.repeat(400), product), undefined);
assert.equal(replyPolicyError('Useful suggestion', product), undefined);
const permissive = parseProduct({ ...minimal, writing: { permitLinks: true, forbiddenWording: [] } });
assert.equal(replyPolicyError('https://example.com', permissive), undefined);
const filtered = parseProduct({ ...minimal, listening: { phrases: ['help'], skipText: ['sponsored'], skipHandles: ['@Excluded'] } });
assert.equal(excludedPost('SPONSORED content', 'any', filtered), true);
assert.equal(excludedPost('hello', 'excluded', filtered), true);

const directory = mkdtempSync(join(tmpdir(), 'product-config-'));
try {
  writeFileSync(join(directory, 'one.json'), JSON.stringify(minimal));
  writeFileSync(join(directory, 'two.json'), JSON.stringify([{ ...minimal, key: 'second', active: false }]));
  assert.equal(loadProducts(directory).length, 2);
  writeFileSync(join(directory, 'two.json'), JSON.stringify(minimal));
  assert.throws(() => loadProducts(directory), /duplicate/);
  writeFileSync(join(directory, 'two.json'), '{bad json');
  assert.throws(() => loadProducts(directory), /two.json/);
} finally { rmSync(directory, { recursive: true, force: true }); }
const example = JSON.parse(readFileSync(new URL('../products/examples/briefgarden.json', import.meta.url), 'utf8'));
assert.equal(parseProduct(example).enabled, false);
console.log('Joi environment, product loading, defaults, exclusions and reply policies passed.');
