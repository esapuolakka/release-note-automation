import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { toHtml, toPlainText, toSlackMrkdwn } from '../src/format.js';
import { buildEmail } from '../src/notify/email.js';
import { summarize } from '../src/llm.js';
import { collectChanges, buildChangesText } from '../src/github.js';

const env = { GITHUB_REPOSITORY: 'acme/app' };

test('config precedence: defaults < env < cli', () => {
  const a = loadConfig({ argv: [], env: { ...env, RN_BRANCH: 'master', RN_EMAIL_TO: 'a@x.com, b@x.com' } });
  assert.equal(a.config.source.branch, 'master');
  assert.deepEqual(a.config.email.to, ['a@x.com', 'b@x.com']);
  const b = loadConfig({ argv: ['--branch', 'develop', '--provider', 'openai', '--dry-run'], env: { ...env, RN_BRANCH: 'master' } });
  assert.equal(b.config.source.branch, 'develop');
  assert.equal(b.config.llm.model, 'gpt-4o-mini');
  assert.equal(b.config.llm.apiKeyEnv, 'OPENAI_API_KEY');
  assert.equal(b.dryRun, true);
});

test('config rejects bad repo and provider', () => {
  assert.throws(() => loadConfig({ argv: [], env: {} }), /owner\/repo/);
  assert.throws(() => loadConfig({ argv: ['--provider', 'nope'], env }), /Unknown llm.provider/);
});

test('formatters', () => {
  const md = '- **Checkout:** faster <pay>\n* Profile fixed';
  assert.equal(toPlainText(md), '- Checkout: faster <pay>\n- Profile fixed');
  assert.match(toHtml(md), /<li><strong>Checkout:<\/strong> faster &lt;pay&gt;<\/li>/);
  assert.equal(toSlackMrkdwn(md), '• *Checkout:* faster &lt;pay&gt;\n• Profile fixed');
});

test('email builds subject, recipients and requires recipients', () => {
  const { config } = loadConfig({ argv: [], env: { ...env, RN_EMAIL_TO: 'a@x.com', SMTP_USER: 'bot@x.com' } });
  const changes = { name: 'v1', tag: 'v1', repository: 'acme/app', url: 'https://example/r' };
  const m = buildEmail({ changes, summary: '- hi', config, env: { SMTP_USER: 'bot@x.com' } });
  assert.equal(m.subject, 'Release notes - v1');
  assert.equal(m.from, 'bot@x.com');
  assert.match(m.text, /Release link: https:\/\/example\/r/);
  config.email.to = [];
  assert.throws(() => buildEmail({ changes, summary: '-', config }), /recipients/);
});

test('llm: anthropic and openai request shapes', async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, json: async () => (String(url).includes('anthropic') ? { content: [{ type: 'text', text: ' - a ' }] } : { choices: [{ message: { content: '- b' } }] }) };
  };
  try {
    const mk = (provider) => loadConfig({ argv: ['--provider', provider], env }).config.llm;
    assert.equal(await summarize(mk('anthropic'), 'SYS', 'x', { ANTHROPIC_API_KEY: 'k' }), '- a');
    assert.equal(calls[0].body.system, 'SYS');
    assert.equal(calls[0].headers['x-api-key'], 'k');
    assert.equal(await summarize(mk('openai'), 'SYS', 'x', { OPENAI_API_KEY: 'k' }), '- b');
    assert.equal(calls[1].body.messages[0].role, 'system');
    await assert.rejects(summarize(mk('openai'), 's', 'x', {}), /OPENAI_API_KEY/);
  } finally {
    globalThis.fetch = real;
  }
});

test('collectChanges picks the previous release and PR window', async () => {
  const rel = (tag, date, extra = {}) => ({ tag_name: tag, published_at: date, html_url: `u/${tag}`, ...extra });
  const seen = {};
  const gh = {
    getRelease: async (_, t) => (t === 'v2' ? rel('v2', '2026-02-01T00:00:00Z', { name: 'Two' }) : null),
    getLatestRelease: async () => null,
    listReleases: async () => [rel('v3', '2026-03-01T00:00:00Z'), rel('v2', '2026-02-01T00:00:00Z'), rel('v1', '2026-01-01T00:00:00Z')],
    getTagDate: async () => null,
    searchMergedPRs: async (_, o) => ((seen.o = o), [{ number: 1, title: 'T', body: 'B' }]),
  };
  const c = await collectChanges(gh, { repository: 'a/b', tag: 'v2', branch: 'main', maxPullRequests: 10 });
  assert.equal(c.previousTag, 'v1');
  assert.deepEqual([seen.o.since, seen.o.until, seen.o.branch], ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', 'main']);
  assert.match(buildChangesText(c), /PR #1: T\nB/);
  assert.equal(buildChangesText({ prs: [], body: 'from release body' }), 'from release body');
});
