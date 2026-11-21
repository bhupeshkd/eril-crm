import { Fragment, type ReactNode } from 'react';

/**
 * Small, safe Markdown renderer for blog posts. Builds React elements (never raw HTML), so post bodies can't inject
 * markup. Supports headings, paragraphs, **bold**, *italic*, ~~strike~~, `code`, fenced code, links (http/https/mailto/
 * relative), https images, bullet/numbered lists, blockquotes and horizontal rules.
 */

const SAFE_LINK = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;
const SAFE_IMG = /^https:\/\//i;

function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: code first (no formatting inside), then images, links, emphasis.
  const re = /(`[^`]+`)|(!\[([^\]]*)\]\(([^)\s]+)\))|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)|(~~([^~]+)~~)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} className="rounded bg-black/5 px-1 py-0.5 text-[0.9em]">{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(SAFE_IMG.test(m[4]) ? <img key={k} src={m[4]} alt={m[3]} loading="lazy" className="my-4 inline-block max-w-full rounded-lg" /> : m[3]);
    else if (m[5]) {
      const href = m[7];
      out.push(SAFE_LINK.test(href) ? <a key={k} href={href} className="underline underline-offset-2" {...(/^https?:/i.test(href) ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}>{inline(m[6], k)}</a> : m[6]);
    } else if (m[8] || m[10]) out.push(<strong key={k}>{inline(m[9] ?? m[11], k)}</strong>);
    else if (m[12] || m[14]) out.push(<em key={k}>{inline(m[13] ?? m[15], k)}</em>);
    else if (m[16]) out.push(<del key={k}>{inline(m[17], k)}</del>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${k++}`;
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={key} className="my-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100"><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = ['', 'mt-8 mb-3 text-3xl font-bold', 'mt-8 mb-3 text-2xl font-bold', 'mt-6 mb-2 text-xl font-semibold', 'mt-5 mb-2 text-lg font-semibold'][level];
      const Tag = (['h1', 'h2', 'h3', 'h4'] as const)[level - 1];
      blocks.push(<Tag key={key} className={cls}>{inline(h[2], key)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*_]\s*){3,}$/.test(line)) { blocks.push(<hr key={key} className="my-8 border-black/10" />); i++; continue; }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key} className="my-4 border-l-4 border-current/20 pl-4 italic opacity-80">{inline(q.join(' '), key)}</blockquote>);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={key} className={`my-4 space-y-1 pl-6 ${ordered ? 'list-decimal' : 'list-disc'}`}>{items.map((t, j) => <li key={j}>{inline(t, `${key}-${j}`)}</li>)}</L>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]) && !/^\s*([-*_]\s*){3,}$/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={key} className="my-4 leading-relaxed">{para.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, `${key}-${j}`)}</Fragment>)}</p>);
  }
  return <div className={className}>{blocks}</div>;
}
