import { toSlackMrkdwn } from '../format.js';

export function buildSlackPayload({ changes, summary, env = process.env }) {
  return {
    channel: env.SLACK_CHANNEL_ID,
    text: `Release ${changes.name}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `🚀 ${changes.name}`.slice(0, 150) } },
      { type: 'section', text: { type: 'mrkdwn', text: toSlackMrkdwn(summary).slice(0, 3000) } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'View release' }, url: changes.url }] },
    ],
  };
}

export async function sendSlack(ctx) {
  const { env = process.env } = ctx;
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_CHANNEL_ID) throw new Error('Slack target needs SLACK_BOT_TOKEN and SLACK_CHANNEL_ID.');
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify(buildSlackPayload(ctx)),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return `Posted to Slack channel ${env.SLACK_CHANNEL_ID}`;
}
