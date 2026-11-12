const BULLET = /^\s*[-*•]\s+(.*)$/;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text: bullets normalised to "- ", bold markers stripped. */
export function toPlainText(md) {
  return md
    .split('\n')
    .map((l) => (BULLET.test(l) ? `- ${l.match(BULLET)[1]}` : l).replace(/\*\*(.+?)\*\*/g, '$1'))
    .join('\n');
}

export function toHtml(md) {
  const out = [];
  let inList = false;
  for (const line of md.split('\n')) {
    const m = line.match(BULLET);
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (m) {
      if (!inList) out.push('<ul>');
      inList = true;
      out.push(`<li>${inline(m[1])}</li>`);
    } else {
      if (inList) out.push('</ul>');
      inList = false;
      if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

/** Slack mrkdwn: "•" bullets, *bold*, escaped control chars. */
export function toSlackMrkdwn(md) {
  return md
    .split('\n')
    .map((l) => {
      const m = l.match(BULLET);
      const body = esc(m ? m[1] : l).replace(/\*\*(.+?)\*\*/g, '*$1*');
      return m ? `• ${body}` : body;
    })
    .join('\n');
}
