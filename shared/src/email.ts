/**
 * Email template model + renderer, shared by the API (sending) and the web app (live preview),
 * so what you see in the builder is exactly what is sent.
 *
 * Safety: all text is HTML-escaped after merge fields are filled in; only http(s)/mailto/tel
 * links and https images are emitted. Templates never contain raw HTML.
 */

export const EMAIL_BLOCK_TYPES = ['heading', 'text', 'button', 'image', 'divider', 'spacer', 'columns', 'footer'] as const;
export type EmailBlockType = (typeof EMAIL_BLOCK_TYPES)[number];

export interface EmailBlock {
  id: string;
  type: EmailBlockType;
  props: Record<string, any>;
}

export interface EmailTheme {
  background?: string;
  contentBackground?: string;
  primaryColor?: string;
  textColor?: string;
  font?: 'sans' | 'serif';
}

export interface EmailDesign {
  subject?: string;
  previewText?: string;
  theme?: EmailTheme;
  blocks: EmailBlock[];
}

export interface RenderOptions {
  /** Fills {{merge.fields}}; defaults to leaving them unchanged. */
  merge?: (text: string) => string;
  /** When set, an unsubscribe line is appended (marketing email). */
  unsubscribeUrl?: string;
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const color = (c: unknown, fallback: string) => (typeof c === 'string' && COLOR_RE.test(c) ? c : fallback);

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Allows http(s), mailto and tel links only; anything else becomes "#". */
export function safeUrl(u: unknown): string {
  const s = typeof u === 'string' ? u.trim() : '';
  return /^(https?:\/\/|mailto:|tel:)/i.test(s) && !/[\s"'<>]/.test(s) ? s : '#';
}

const safeImage = (u: unknown) => {
  const s = typeof u === 'string' ? u.trim() : '';
  return /^https:\/\//i.test(s) && !/[\s"'<>]/.test(s) ? s : '';
};

/** Escapes text, then supports **bold**, [label](url) and line breaks. */
export function inlineFormat(raw: string, linkColor: string): string {
  let s = escapeHtml(raw);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const href = safeUrl(url.replace(/&amp;/g, '&'));
    return `<a href="${escapeHtml(href)}" style="color:${linkColor};text-decoration:underline">${label}</a>`;
  });
  return s.replace(/\r?\n/g, '<br>');
}

const plain = (raw: string) => raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)');

const align = (a: unknown) => (a === 'center' || a === 'right' ? a : 'left');

export function renderEmail(design: EmailDesign, opts: RenderOptions = {}): { html: string; text: string; subject: string } {
  const merge = opts.merge ?? ((t: string) => t);
  const m = (v: unknown) => merge(typeof v === 'string' ? v : '');
  const t = design.theme ?? {};
  const bg = color(t.background, '#f4f4f5');
  const card = color(t.contentBackground, '#ffffff');
  const primary = color(t.primaryColor, '#2953e0');
  const ink = color(t.textColor, '#1f2937');
  const font = t.font === 'serif' ? "Georgia,'Times New Roman',serif" : "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  const rows: string[] = [];
  const text: string[] = [];
  const cell = (inner: string, pad = '12px 32px') => `<tr><td style="padding:${pad}">${inner}</td></tr>`;

  for (const b of design.blocks ?? []) {
    const p = b.props ?? {};
    switch (b.type) {
      case 'heading': {
        const size = p.size === 'small' ? 18 : p.size === 'large' ? 30 : 24;
        const v = m(p.text);
        rows.push(cell(`<h1 style="margin:0;font-family:${font};font-size:${size}px;line-height:1.25;color:${ink};text-align:${align(p.align)}">${inlineFormat(v, primary)}</h1>`, '24px 32px 8px'));
        text.push(plain(v).toUpperCase(), '');
        break;
      }
      case 'text': {
        const v = m(p.text);
        rows.push(cell(`<p style="margin:0;font-family:${font};font-size:16px;line-height:1.6;color:${ink};text-align:${align(p.align)}">${inlineFormat(v, primary)}</p>`));
        text.push(plain(v), '');
        break;
      }
      case 'button': {
        const label = m(p.label) || 'Learn more';
        const href = safeUrl(m(p.url));
        const btnColor = color(p.color, primary);
        rows.push(
          cell(
            `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align(p.align) === 'left' ? 'left' : align(p.align)}" style="margin:${align(p.align) === 'center' ? '0 auto' : '0'}"><tr><td style="border-radius:6px;background:${btnColor}"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;font-family:${font};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(label)}</a></td></tr></table>`,
            '16px 32px',
          ),
        );
        text.push(`${label}: ${href}`, '');
        break;
      }
      case 'image': {
        const src = safeImage(p.url);
        if (!src) break;
        const alt = escapeHtml(m(p.alt));
        const width = Math.min(536, Math.max(40, Number(p.width) || 536));
        let img = `<img src="${escapeHtml(src)}" alt="${alt}" width="${width}" style="display:block;max-width:100%;height:auto;border:0;margin:${align(p.align) === 'center' ? '0 auto' : '0'}">`;
        const link = safeUrl(m(p.link));
        if (link !== '#') img = `<a href="${escapeHtml(link)}">${img}</a>`;
        rows.push(cell(img));
        if (p.alt) text.push(`[${m(p.alt)}]`, '');
        break;
      }
      case 'divider':
        rows.push(cell(`<hr style="border:0;border-top:1px solid #e5e7eb;margin:0">`));
        text.push('----------', '');
        break;
      case 'spacer':
        rows.push(`<tr><td style="height:${Math.min(120, Math.max(4, Number(p.height) || 24))}px;line-height:0;font-size:0">&nbsp;</td></tr>`);
        break;
      case 'columns': {
        const col = (v: string) => `<td valign="top" width="50%" style="padding:0 8px;font-family:${font};font-size:15px;line-height:1.6;color:${ink}">${inlineFormat(v, primary)}</td>`;
        const left = m(p.left);
        const right = m(p.right);
        rows.push(cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${col(left)}${col(right)}</tr></table>`, '12px 24px'));
        text.push(plain(left), '', plain(right), '');
        break;
      }
      case 'footer': {
        const v = m(p.text);
        rows.push(cell(`<p style="margin:0;font-family:${font};font-size:12px;line-height:1.5;color:#6b7280;text-align:center">${inlineFormat(v, '#6b7280')}</p>`, '24px 32px'));
        text.push('--', plain(v), '');
        break;
      }
    }
  }

  let unsubscribe = '';
  if (opts.unsubscribeUrl) {
    const u = safeUrl(opts.unsubscribeUrl);
    unsubscribe = `<p style="margin:16px 0 0;font-family:${font};font-size:12px;color:#9ca3af;text-align:center">Don't want these emails? <a href="${escapeHtml(u)}" style="color:#9ca3af">Unsubscribe</a></p>`;
    text.push(`Unsubscribe: ${u}`);
  }

  const subject = m(design.subject).replace(/[\r\n]+/g, ' ').trim();
  const preview = m(design.previewText);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${bg}">
${preview ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preview)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${card};border-radius:8px">
${rows.join('\n')}
</table>
${unsubscribe}
</td></tr></table>
</body></html>`;
  return { html, text: text.join('\n').replace(/\n{3,}/g, '\n\n').trim(), subject };
}

/** Starter designs for the template gallery. */
export const EMAIL_STARTERS: Record<string, { name: string; description: string; design: EmailDesign }> = {
  newsletter: {
    name: 'Newsletter',
    description: 'Headline, intro, two columns of news and a call to action',
    design: {
      subject: 'This month at {{business.name}}',
      previewText: 'News, tips and what we have been working on',
      theme: { background: '#f4f4f5', contentBackground: '#ffffff', primaryColor: '#2953e0', textColor: '#1f2937', font: 'sans' },
      blocks: [
        { id: 'h1', type: 'heading', props: { text: 'Hi {{contact.firstName}}, here is your monthly update', align: 'left', size: 'large' } },
        { id: 't1', type: 'text', props: { text: 'A quick round-up of what is new, plus one tip you can use **this week**.' } },
        { id: 'c1', type: 'columns', props: { left: '**What is new**\nWe launched online booking — pick a time that suits you.', right: '**Tip of the month**\nReply to reviews within 24 hours to win more trust.' } },
        { id: 'b1', type: 'button', props: { label: 'Book a call', url: 'https://example.com/book', align: 'left' } },
        { id: 'd1', type: 'divider', props: {} },
        { id: 'f1', type: 'footer', props: { text: '{{business.name}} · You are receiving this because you are a customer.' } },
      ],
    },
  },
  promotion: {
    name: 'Promotion',
    description: 'Big offer, coupon code and a bold button',
    design: {
      subject: '{{contact.firstName}}, 20% off ends Friday',
      previewText: 'Use code SAVE20 at checkout',
      theme: { background: '#111827', contentBackground: '#ffffff', primaryColor: '#e11d48', textColor: '#111827', font: 'sans' },
      blocks: [
        { id: 'h1', type: 'heading', props: { text: '20% off everything', align: 'center', size: 'large' } },
        { id: 't1', type: 'text', props: { text: 'For a limited time, use code **SAVE20** on any service.', align: 'center' } },
        { id: 'b1', type: 'button', props: { label: 'Claim my discount', url: 'https://example.com/offer', align: 'center' } },
        { id: 's1', type: 'spacer', props: { height: 16 } },
        { id: 'f1', type: 'footer', props: { text: 'Offer ends Friday at midnight.' } },
      ],
    },
  },
  welcome: {
    name: 'Welcome',
    description: 'Friendly welcome for new leads with next steps',
    design: {
      subject: 'Welcome aboard, {{contact.firstName}}!',
      previewText: 'Here is how to get started',
      theme: { background: '#eef2ff', contentBackground: '#ffffff', primaryColor: '#4f46e5', textColor: '#1f2937', font: 'sans' },
      blocks: [
        { id: 'h1', type: 'heading', props: { text: 'Welcome, {{contact.firstName}}! 👋', size: 'large' } },
        { id: 't1', type: 'text', props: { text: 'Thanks for reaching out. Here is what happens next:\n1. We review your details\n2. We send you a short plan\n3. We book a quick call' } },
        { id: 'b1', type: 'button', props: { label: 'Pick a call time', url: 'https://example.com/book' } },
        { id: 'f1', type: 'footer', props: { text: 'Questions? Just reply to this email.' } },
      ],
    },
  },
  blank: {
    name: 'Blank',
    description: 'Start from scratch',
    design: { subject: '', previewText: '', theme: {}, blocks: [{ id: 't1', type: 'text', props: { text: 'Hi {{contact.firstName}},' } }] },
  },
};
