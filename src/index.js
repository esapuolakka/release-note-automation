#!/usr/bin/env node
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { GitHub, collectChanges, buildChangesText } from './github.js';
import { summarize } from './llm.js';
import { targets } from './notify/index.js';

const HELP = `Usage: node src/index.js [options]

  -c, --config <file>     Config file (default: release-notes.config.json)
      --repo <owner/repo> GitHub repository to describe
      --branch <name>     Only PRs merged into this branch (main, master, develop, ...)
      --tag <tag>         Release tag (default: latest release)
      --previous-tag <t>  Start of range (default: the release before --tag)
      --targets <list>    Comma separated: ${Object.keys(targets).join(', ')}
      --provider <name>   LLM provider: anthropic | openai
      --model <id>        LLM model id
      --dry-run           Generate notes and print them; send nothing
`;

async function main() {
  const { config, dryRun, help } = loadConfig({ argv: process.argv.slice(2) });
  if (help) return console.log(HELP);

  for (const t of config.targets) {
    if (!targets[t]) throw new Error(`Unknown target "${t}". Available: ${Object.keys(targets).join(', ')}`);
  }

  const gh = new GitHub(process.env.GITHUB_TOKEN);
  const changes = await collectChanges(gh, config.source);
  console.log(`Release ${changes.tag} of ${changes.repository}: ${changes.prs.length} PR(s) since ${changes.previousTag ?? 'the beginning'}`);
  changes.prs.forEach((pr) => console.log(`  #${pr.number} ${pr.title}`));

  const changesText = buildChangesText(changes);
  const summary = changesText
    ? await summarize(config.llm, fs.readFileSync(config.promptFile, 'utf8'), changesText)
    : 'No release notes available for this release.';

  const ctx = { changes, summary, config, env: process.env };
  if (dryRun) {
    console.log('\n--- Release notes ---\n' + summary);
    for (const t of config.targets) console.log(`\n--- Preview: ${t} ---\n${targets[t].preview(ctx)}`);
    return;
  }

  let failed = false;
  for (const t of config.targets) {
    try {
      console.log(`[${t}] ${await targets[t].send(ctx)}`);
    } catch (e) {
      failed = true;
      console.error(`[${t}] FAILED: ${e.message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
