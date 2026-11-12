const API = 'https://api.github.com';

export class GitHub {
  constructor(token) {
    this.token = token;
  }

  async request(path, params = {}) {
    const url = new URL(path.startsWith('http') ? path : API + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ai-release-notes',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(url, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url.pathname}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  getRelease(repo, tag) {
    return this.request(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  }

  getLatestRelease(repo) {
    return this.request(`/repos/${repo}/releases/latest`);
  }

  async listReleases(repo) {
    return (await this.request(`/repos/${repo}/releases`, { per_page: 100 })) ?? [];
  }

  async getTagDate(repo, tag) {
    const c = await this.request(`/repos/${repo}/commits/${encodeURIComponent(tag)}`);
    return c?.commit?.committer?.date ?? null;
  }

  /** Merged PRs in (since, until], optionally restricted to a base branch. */
  async searchMergedPRs(repo, { branch, since, until, max }) {
    const q = [`repo:${repo}`, 'is:pr', 'is:merged', branch && `base:${branch}`, `merged:${since || '*'}..${until}`]
      .filter(Boolean)
      .join(' ');
    const found = [];
    for (let page = 1; found.length < max; page++) {
      const data = await this.request('/search/issues', { q, sort: 'created', order: 'asc', per_page: 100, page });
      const items = data?.items ?? [];
      found.push(...items);
      if (items.length < 100) break;
    }
    return found
      .map((i) => ({ number: i.number, title: i.title, body: i.body || '', mergedAt: i.pull_request?.merged_at ?? i.closed_at }))
      .filter((pr) => !since || pr.mergedAt > since)
      .slice(0, max);
  }
}

/** Work out which release to describe and which PRs it contains. */
export async function collectChanges(gh, source) {
  const repo = source.repository;
  let tag = source.tag;
  let release = null;

  if (tag) {
    release = await gh.getRelease(repo, tag);
  } else {
    release = await gh.getLatestRelease(repo);
    if (!release) throw new Error(`No published release found in ${repo}. Pass a tag (RN_TAG / --tag).`);
    tag = release.tag_name;
  }

  const until = release?.published_at ?? (await gh.getTagDate(repo, tag));
  if (!until) throw new Error(`Tag "${tag}" was not found in ${repo}.`);

  let previousTag = source.previousTag;
  let since = null;
  if (previousTag) {
    const prev = await gh.getRelease(repo, previousTag);
    since = prev?.published_at ?? (await gh.getTagDate(repo, previousTag));
    if (!since) throw new Error(`previousTag "${previousTag}" was not found in ${repo}.`);
  } else {
    const releases = await gh.listReleases(repo);
    const prev = releases.find((r) => !r.draft && r.tag_name !== tag && r.published_at && r.published_at < until);
    previousTag = prev?.tag_name ?? null;
    since = prev?.published_at ?? null;
  }

  const prs = await gh.searchMergedPRs(repo, { branch: source.branch, since, until, max: source.maxPullRequests });

  return {
    repository: repo,
    tag,
    name: release?.name || tag,
    url: release?.html_url ?? `https://github.com/${repo}/releases/tag/${tag}`,
    body: (release?.body ?? '').trim(),
    previousTag,
    since,
    until,
    prs,
  };
}

const MAX_BODY = 4000;
const MAX_TOTAL = 60000;

/** Text handed to the LLM. Falls back to the release body when no PRs were found. */
export function buildChangesText(changes) {
  let text = changes.prs
    .map((pr) => `PR #${pr.number}: ${pr.title}\n${pr.body.slice(0, MAX_BODY)}`)
    .join('\n\n---\n\n');
  if (!text) text = changes.body;
  return text.slice(0, MAX_TOTAL);
}
