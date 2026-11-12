import nodemailer from 'nodemailer';
import { toHtml, toPlainText } from '../format.js';

const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

export function buildEmail({ changes, summary, config, env = process.env }) {
  const e = config.email;
  const to = e.to;
  if (!to?.length) throw new Error('No email recipients: set email.to in the config file or RN_EMAIL_TO.');
  const from = e.from || env.SMTP_USER;
  if (!from) throw new Error('No sender address: set email.from (RN_EMAIL_FROM) or SMTP_USER.');

  const subject = fill(e.subject, { release: changes.name, tag: changes.tag, repository: changes.repository });
  const link = changes.url;
  return {
    from,
    to,
    subject,
    text: `${toPlainText(summary)}\n\nRelease link: ${link}\n`,
    html: `<h2>${changes.name.replace(/</g, '&lt;')}</h2>\n${toHtml(summary)}\n<p><a href="${link}">View release</a></p>`,
  };
}

export async function sendEmail(ctx) {
  const { config, env = process.env } = ctx;
  const message = buildEmail(ctx);
  const smtp = config.email.smtp;
  if (!smtp.host) throw new Error('No SMTP host: set email.smtp.host in the config file or SMTP_HOST.');
  const port = Number(smtp.port) || 587;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: smtp.secure ?? port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  const info = await transport.sendMail(message);
  return `Email sent to ${message.to.join(', ')} (${info.messageId})`;
}
