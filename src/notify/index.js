import { sendEmail, buildEmail } from './email.js';
import { sendSlack, buildSlackPayload } from './slack.js';

/** Register new targets here. Each takes { changes, summary, config, env } and returns a status string. */
export const targets = {
  email: { send: sendEmail, preview: (c) => { const m = buildEmail(c); return `To: ${m.to.join(', ')}\nSubject: ${m.subject}\n\n${m.text}`; } },
  slack: { send: sendSlack, preview: (c) => JSON.stringify(buildSlackPayload(c), null, 2) },
};
