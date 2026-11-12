# AI release notes

Turns the pull requests in a GitHub release into short, plain-language release notes using an LLM, and delivers them to **email** (and optionally **Slack**).

```
GitHub release ─► merged PRs in the release window ─► LLM (Anthropic / OpenAI-compatible) ─► email / Slack
```

Everything is configurable: which repo, which branch, which release tag, which LLM, which targets.

## Quick start (email via GitHub Actions)

1. Edit [release-notes.config.json](release-notes.config.json) or use repository **Variables** (below). Minimum: `email.to` (or `RN_EMAIL_TO`) and `email.smtp.host`.
2. Add repository **Secrets**: `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`), `SMTP_USER`, `SMTP_PASSWORD`.
   Gmail: use an [app password](https://myaccount.google.com/apppasswords) with `smtp.gmail.com`, port 465.
3. Test without sending: **Actions → Release notes → Run workflow**, tick *dry_run*, optionally give a tag. The notes and a preview of each target appear in the job log.
4. Publish a release. The workflow runs on every published release.

Set the repository variable `RELEASE_NOTES_ENABLED=false` to switch it off.

## Configuration

Precedence, low to high: **defaults < `release-notes.config.json` < environment variables (repo Variables in Actions) < CLI flags / workflow inputs.**

| Setting | Config key | Env / repo Variable | CLI flag |
|---|---|---|---|
| Repository (`owner/repo`) | `source.repository` | `RN_REPOSITORY` | `--repo` |
| Branch PRs were merged into (`main`, `master`, `develop`…) | `source.branch` | `RN_BRANCH` | `--branch` |
| Release tag (default: latest release) | `source.tag` | `RN_TAG` | `--tag` |
| Range start tag (default: previous release) | `source.previousTag` | `RN_PREVIOUS_TAG` | `--previous-tag` |
| LLM provider: `anthropic` \| `openai` | `llm.provider` | `RN_LLM_PROVIDER` | `--provider` |
| LLM model | `llm.model` | `RN_LLM_MODEL` | `--model` |
| LLM endpoint (OpenAI-compatible servers) | `llm.baseUrl` | `RN_LLM_BASE_URL` | |
| Targets, comma separated | `targets` | `RN_TARGETS` | `--targets` |
| Prompt file | `promptFile` | `RN_PROMPT_FILE` | |
| Email recipients | `email.to` | `RN_EMAIL_TO` | |
| Email sender (default `SMTP_USER`) | `email.from` | `RN_EMAIL_FROM` | |
| Email subject (`{{release}}`, `{{tag}}`, `{{repository}}`) | `email.subject` | `RN_EMAIL_SUBJECT` | |
| SMTP host / port / TLS | `email.smtp.*` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | |

**Secrets** (environment only, never in the config file): `GITHUB_TOKEN`, `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (name overridable with `llm.apiKeyEnv`), `SMTP_USER`, `SMTP_PASSWORD`, `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`.

### Recipes

- **A different or private repo:** set `RN_REPOSITORY`, add a `SOURCE_GITHUB_TOKEN` secret with read access to its pull requests and contents, and run the workflow manually (or add a schedule). Leave the tag empty for the latest release.
- **`master` instead of `main`:** `RN_BRANCH=master`. Leave the branch empty to include PRs merged into any branch.
- **OpenAI or a compatible server:** `RN_LLM_PROVIDER=openai`, plus `RN_LLM_BASE_URL` for non-OpenAI endpoints (Groq, Ollama, …) and the matching `llm.apiKeyEnv`.
- **Email and Slack:** `RN_TARGETS=email,slack`. Slack needs a bot with `chat:write`, invited to the channel.
- **Different audience or tone:** copy [prompts/release-notes.md](prompts/release-notes.md), edit it, and point `promptFile` at it. [prompts/examples/](prompts/examples/) has a project-specific example.

## Running locally

```bash
npm ci
export GITHUB_TOKEN=... ANTHROPIC_API_KEY=...        # see .env.example
node src/index.js --repo owner/repo --branch main --tag v1.2.3 --dry-run
node src/index.js --help
npm test
```

Requires Node 20+. Only dependency: `nodemailer`.

## How the release window is chosen

The notes cover PRs merged into the configured branch after the previous published release (or `previousTag`) and up to the selected release. If no PRs are found, the release body is summarised instead. If that is empty too, a "no notes available" message is sent.

## Adding a target

Create `src/notify/<name>.js` exporting a `send(ctx)` function and register it in [src/notify/index.js](src/notify/index.js). `ctx` has `changes`, `summary`, `config` and `env`.

## Notes

- PR text is untrusted input: instructions live in the system prompt and PR text is fenced as data.
- The default model is `claude-haiku-5-5` / `gpt-4o-mini`; override with `llm.model` if your account uses another.
- Releases created by another workflow using the default `GITHUB_TOKEN` do not trigger this workflow (GitHub limitation); use a PAT or GitHub App token there, or run it manually.
