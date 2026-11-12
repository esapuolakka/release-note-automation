import fs from 'node:fs';
import { parseArgs } from 'node:util';

export const PROVIDERS = {
  anthropic: {
    model: 'claude-haiku-5-5',
    baseUrl: 'https://api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  // Also works for any OpenAI-compatible API (Groq, Ollama, Azure proxy, ...) via llm.baseUrl.
  openai: {
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
};

export const DEFAULTS = {
  source: {
    repository: null, // "owner/repo"; defaults to $GITHUB_REPOSITORY
    branch: null, // only PRs merged into this branch (e.g. main, master, develop); null = any
    tag: null, // release tag to describe; null = latest published release
    previousTag: null, // start of the range; null = release before `tag`
    maxPullRequests: 100,
  },
  llm: {
    provider: 'anthropic',
    model: null,
    baseUrl: null,
    apiKeyEnv: null,
    maxTokens: 800,
  },
  promptFile: 'prompts/release-notes.md',
  targets: ['email'],
  email: {
    to: [],
    from: null,
    subject: 'Release notes - {{release}}',
    smtp: { host: null, port: 587, secure: null },
  },
  slack: {},
};

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = isObject(v) && isObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

const list = (s) =>
  String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Environment variables (non-secret settings) that override the config file. Empty = unset. */
function fromEnv(env) {
  const e = (k) => (env[k] && String(env[k]).trim() !== '' ? String(env[k]).trim() : undefined);
  const o = { source: {}, llm: {}, email: { smtp: {} } };
  const set = (obj, key, val) => val !== undefined && (obj[key] = val);

  set(o.source, 'repository', e('RN_REPOSITORY'));
  set(o.source, 'branch', e('RN_BRANCH'));
  set(o.source, 'tag', e('RN_TAG'));
  set(o.source, 'previousTag', e('RN_PREVIOUS_TAG'));
  set(o.llm, 'provider', e('RN_LLM_PROVIDER'));
  set(o.llm, 'model', e('RN_LLM_MODEL'));
  set(o.llm, 'baseUrl', e('RN_LLM_BASE_URL'));
  if (e('RN_TARGETS')) o.targets = list(e('RN_TARGETS'));
  set(o, 'promptFile', e('RN_PROMPT_FILE'));
  if (e('RN_EMAIL_TO')) o.email.to = list(e('RN_EMAIL_TO'));
  set(o.email, 'from', e('RN_EMAIL_FROM'));
  set(o.email, 'subject', e('RN_EMAIL_SUBJECT'));
  set(o.email.smtp, 'host', e('SMTP_HOST'));
  if (e('SMTP_PORT')) o.email.smtp.port = Number(e('SMTP_PORT'));
  if (e('SMTP_SECURE')) o.email.smtp.secure = e('SMTP_SECURE') === 'true';
  return o;
}

export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: 'string', short: 'c' },
      repo: { type: 'string' },
      branch: { type: 'string' },
      tag: { type: 'string' },
      'previous-tag': { type: 'string' },
      targets: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  return values;
}

function fromCli(v) {
  const o = { source: {}, llm: {} };
  if (v.repo) o.source.repository = v.repo;
  if (v.branch) o.source.branch = v.branch;
  if (v.tag) o.source.tag = v.tag;
  if (v['previous-tag']) o.source.previousTag = v['previous-tag'];
  if (v.provider) o.llm.provider = v.provider;
  if (v.model) o.llm.model = v.model;
  if (v.targets) o.targets = list(v.targets);
  return o;
}

/** Precedence (low -> high): defaults < config file < environment < CLI flags. */
export function loadConfig({ argv = [], env = process.env } = {}) {
  const cli = parseCli(argv);
  const file = cli.config ?? env.RN_CONFIG ?? 'release-notes.config.json';
  let fileCfg = {};
  if (fs.existsSync(file)) fileCfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  else if (cli.config) throw new Error(`Config file not found: ${file}`);

  let cfg = deepMerge(DEFAULTS, fileCfg);
  cfg = deepMerge(cfg, fromEnv(env));
  cfg = deepMerge(cfg, fromCli(cli));

  cfg.source.repository ||= env.GITHUB_REPOSITORY || null;
  if (!cfg.source.repository || !/^[^/\s]+\/[^/\s]+$/.test(cfg.source.repository)) {
    throw new Error('source.repository must be "owner/repo" (set RN_REPOSITORY, --repo, or the config file).');
  }

  const p = PROVIDERS[cfg.llm.provider];
  if (!p) {
    throw new Error(`Unknown llm.provider "${cfg.llm.provider}". Supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  cfg.llm.model ||= p.model;
  cfg.llm.baseUrl ||= p.baseUrl;
  cfg.llm.apiKeyEnv ||= p.apiKeyEnv;

  if (!cfg.targets.length) throw new Error('At least one target is required (targets: ["email"]).');
  return { config: cfg, dryRun: Boolean(cli['dry-run']), help: Boolean(cli.help) };
}
