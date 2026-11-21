import { describe, expect, it } from 'vitest';
import { EMAIL_STARTERS, inlineFormat, renderEmail, safeUrl } from '@eril/shared';

describe('safeUrl', () => {
  it.each([
    ['https://a.com/x', 'https://a.com/x'],
    ['mailto:a@b.co', 'mailto:a@b.co'],
    ['tel:+15551234', 'tel:+15551234'],
    ['javascript:alert(1)', '#'],
    ['data:text/html,x', '#'],
    ['https://a.com/"onmouseover=x', '#'],
    ['', '#'],
  ])('%s → %s', (input, out) => expect(safeUrl(input)).toBe(out));
});

describe('inlineFormat', () => {
  it('escapes html and supports bold, links, line breaks', () => {
    expect(inlineFormat('<b>x</b> **y**\n[go](https://a.com)', '#000')).toBe(
      '&lt;b&gt;x&lt;/b&gt; <strong>y</strong><br><a href="https://a.com" style="color:#000;text-decoration:underline">go</a>',
    );
  });
  it('neutralises javascript links', () => {
    expect(inlineFormat('[x](javascript:alert(1))', '#000')).toContain('href="#"');
  });
});

describe('renderEmail', () => {
  const merge = (s: string) => s.replace(/\{\{contact\.firstName\}\}/g, 'Ann <img src=x onerror=alert(1)>');

  it('escapes merged values (no script injection via contact data)', () => {
    const { html, subject } = renderEmail({ subject: 'Hi {{contact.firstName}}', blocks: [{ id: 'h', type: 'heading', props: { text: 'Hello {{contact.firstName}}' } }] }, { merge });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('Ann &lt;img src=x onerror=alert(1)&gt;');
    expect(subject).toBe('Hi Ann <img src=x onerror=alert(1)>'); // subject is plain text, never HTML
  });

  it('drops non-https images and unsafe theme colours', () => {
    const { html } = renderEmail({
      theme: { primaryColor: 'red;background:url(x)' as string },
      blocks: [
        { id: 'i', type: 'image', props: { url: 'http://x.com/a.png' } },
        { id: 'b', type: 'button', props: { label: 'Go', url: 'https://x.com' } },
      ],
    });
    expect(html).not.toContain('http://x.com/a.png');
    expect(html).toContain('background:#2953e0');
    expect(html).not.toContain('url(x)');
  });

  it('adds unsubscribe to html and text', () => {
    const r = renderEmail({ blocks: [{ id: 't', type: 'text', props: { text: 'Hi' } }] }, { unsubscribeUrl: 'https://app/unsub?c=1&t=2' });
    expect(r.html).toContain('href="https://app/unsub?c=1&amp;t=2"');
    expect(r.text).toContain('Unsubscribe: https://app/unsub?c=1&t=2');
  });

  it('renders every starter without throwing', () => {
    for (const s of Object.values(EMAIL_STARTERS)) {
      const r = renderEmail(s.design, { merge: (x) => x });
      expect(r.html.startsWith('<!doctype html>')).toBe(true);
      expect(r.text.length).toBeGreaterThan(0);
    }
  });
});
