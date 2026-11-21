'use client';

import { fmtCurrency } from '@/lib/api';

export type BlockType = 'hero' | 'text' | 'features' | 'image' | 'video' | 'cta' | 'form' | 'booking' | 'pricing' | 'reviews' | 'faq' | 'footer';
export interface SiteBlock { id: string; type: BlockType; props: Record<string, any> }
export interface SitePage { id: string; title: string; path: string; description?: string; blocks: SiteBlock[] }
export interface SiteTheme { primaryColor?: string; background?: string; font?: 'sans' | 'serif' }
export interface Embeds {
  forms: Array<{ id: string; name: string; slug: string }>;
  calendars: Array<{ id: string; name: string; slug: string }>;
  products: Array<{ id: string; name: string; description: string; price: number; currency: string; interval: string }>;
  reviews: Array<{ rating: number; comment: string; author: string }>;
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero: 'Hero banner',
  text: 'Text section',
  features: 'Features grid',
  image: 'Image',
  video: 'Video',
  cta: 'Call to action',
  form: 'Form',
  booking: 'Booking calendar',
  pricing: 'Pricing (products)',
  reviews: 'Reviews',
  faq: 'FAQ',
  footer: 'Footer',
};

export const BLOCK_DEFAULTS: Record<BlockType, Record<string, any>> = {
  hero: { heading: 'A headline that sells the outcome', subheading: 'One sentence that explains who it is for.', buttonText: 'Get started', buttonLink: 'next' },
  text: { heading: 'Section title', body: 'Write something useful here.' },
  features: { heading: 'Why choose us', items: [{ title: 'Fast', body: 'We move quickly.' }, { title: 'Friendly', body: 'Real humans.' }, { title: 'Proven', body: 'Hundreds of clients.' }] },
  image: { imageUrl: '', alt: '' },
  video: { videoUrl: '' },
  cta: { heading: 'Ready to get started?', buttonText: 'Book a call', buttonLink: 'next' },
  form: {},
  booking: {},
  pricing: { heading: 'Pricing' },
  reviews: { heading: 'What our customers say' },
  faq: { heading: 'Questions', items: [{ q: 'How long does it take?', a: 'Usually two weeks.' }] },
  footer: { text: '© Your business' },
};

/** Resolve a button link: "next" → next funnel step, "/path" → site page, else absolute URL. */
export function resolveLink(link: string | undefined, ctx: { base: string; nextPath: string | null }) {
  if (!link) return undefined;
  if (link === 'next') return ctx.nextPath === null ? undefined : `${ctx.base}${ctx.nextPath ? `/${ctx.nextPath}` : ''}`;
  if (link.startsWith('/')) return `${ctx.base}${link === '/' ? '' : link}`;
  if (/^(https?:|mailto:|tel:|#)/i.test(link)) return link;
  return undefined;
}

function videoEmbed(url: string) {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

export function BlockView({
  block,
  theme,
  embeds,
  link,
  preview,
}: {
  block: SiteBlock;
  theme: SiteTheme;
  embeds: Embeds;
  link: (l?: string) => string | undefined;
  preview?: boolean;
}) {
  const p = block.props ?? {};
  const color = theme.primaryColor || '#2953e0';
  const Btn = ({ text, href }: { text?: string; href?: string }) =>
    text ? (
      <a
        href={preview ? undefined : href}
        className="inline-block rounded-md px-5 py-3 font-semibold text-white shadow-sm hover:opacity-90"
        style={{ backgroundColor: color }}
        onClick={preview ? (e) => e.preventDefault() : undefined}
      >
        {text}
      </a>
    ) : null;

  switch (block.type) {
    case 'hero':
      return (
        <section className="px-6 py-16 text-center sm:py-24">
          <h1 className="mx-auto max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">{p.heading}</h1>
          {p.subheading && <p className="mx-auto mt-4 max-w-2xl text-lg opacity-80">{p.subheading}</p>}
          {p.image && <img src={p.image} alt="" className="mx-auto mt-8 max-h-96 rounded-lg" />}
          <div className="mt-8"><Btn text={p.buttonText} href={link(p.buttonLink)} /></div>
        </section>
      );
    case 'text':
      return (
        <section className="mx-auto max-w-3xl px-6 py-10">
          {p.heading && <h2 className="text-2xl font-bold">{p.heading}</h2>}
          {p.body && <p className="mt-3 whitespace-pre-wrap text-lg leading-relaxed opacity-80">{p.body}</p>}
        </section>
      );
    case 'features':
      return (
        <section className="mx-auto max-w-5xl px-6 py-12">
          {p.heading && <h2 className="mb-8 text-center text-2xl font-bold">{p.heading}</h2>}
          <div className="grid gap-6 sm:grid-cols-3">
            {(p.items ?? []).map((it: any, i: number) => (
              <div key={i} className="rounded-lg border border-black/10 p-5">
                <div className="mb-2 h-1.5 w-8 rounded" style={{ backgroundColor: color }} />
                <h3 className="font-semibold">{it.title}</h3>
                <p className="mt-1 text-sm opacity-75">{it.body}</p>
              </div>
            ))}
          </div>
        </section>
      );
    case 'image':
      return p.imageUrl ? (
        <section className="mx-auto max-w-4xl px-6 py-8"><img src={p.imageUrl} alt={p.alt ?? ''} className="w-full rounded-lg" /></section>
      ) : preview ? <Placeholder text="Add an image URL" /> : null;
    case 'video': {
      const src = p.videoUrl ? videoEmbed(p.videoUrl) : null;
      return src ? (
        <section className="mx-auto max-w-4xl px-6 py-8">
          <div className="aspect-video overflow-hidden rounded-lg"><iframe src={src} title="Video" className="h-full w-full" allowFullScreen /></div>
        </section>
      ) : preview ? <Placeholder text="Paste a YouTube or Vimeo link" /> : null;
    }
    case 'cta':
      return (
        <section className="px-6 py-14 text-center" style={{ backgroundColor: `${color}12` }}>
          <h2 className="text-2xl font-bold">{p.heading}</h2>
          <div className="mt-6"><Btn text={p.buttonText} href={link(p.buttonLink)} /></div>
        </section>
      );
    case 'form': {
      const f = embeds.forms.find((x) => x.id === p.formId) ?? (p.formId ? null : embeds.forms[0]);
      return f ? (
        <section className="mx-auto max-w-xl px-6 py-8">
          <iframe src={`/f/${f.slug}?embed=1`} title={f.name} className="h-[640px] w-full rounded-lg border border-black/10 bg-white" />
        </section>
      ) : preview ? <Placeholder text="Create a form, then pick it here" /> : null;
    }
    case 'booking': {
      const c = embeds.calendars.find((x) => x.id === p.calendarId) ?? (p.calendarId ? null : embeds.calendars[0]);
      return c ? (
        <section className="mx-auto max-w-4xl px-6 py-8">
          <iframe src={`/book/${c.slug}`} title={c.name} className="h-[720px] w-full rounded-lg border border-black/10 bg-white" />
        </section>
      ) : preview ? <Placeholder text="Create a calendar, then pick it here" /> : null;
    }
    case 'pricing': {
      const ids: string[] | undefined = p.productIds;
      const list = embeds.products.filter((x) => !ids?.length || ids.includes(x.id));
      return (
        <section className="mx-auto max-w-5xl px-6 py-12">
          {p.heading && <h2 className="mb-8 text-center text-2xl font-bold">{p.heading}</h2>}
          {list.length === 0 ? (preview ? <Placeholder text="Add products in Payments" /> : null) : (
            <div className="grid gap-6 sm:grid-cols-3">
              {list.map((x) => (
                <div key={x.id} className="rounded-lg border border-black/10 p-6 text-center">
                  <h3 className="font-semibold">{x.name}</h3>
                  <div className="my-3 text-3xl font-bold">{fmtCurrency(x.price, x.currency)}<span className="text-sm font-normal opacity-60">{x.interval !== 'one_time' ? ` /${x.interval}` : ''}</span></div>
                  {x.description && <p className="text-sm opacity-75">{x.description}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      );
    }
    case 'reviews':
      return (
        <section className="mx-auto max-w-5xl px-6 py-12">
          {p.heading && <h2 className="mb-8 text-center text-2xl font-bold">{p.heading}</h2>}
          {embeds.reviews.length === 0 ? (preview ? <Placeholder text="Published reviews appear here" /> : null) : (
            <div className="grid gap-6 sm:grid-cols-3">
              {embeds.reviews.slice(0, 6).map((r, i) => (
                <figure key={i} className="rounded-lg border border-black/10 p-5">
                  <div aria-label={`${r.rating} out of 5 stars`} className="text-amber-500">{'★'.repeat(r.rating)}<span className="text-black/15">{'★'.repeat(5 - r.rating)}</span></div>
                  {r.comment && <blockquote className="mt-2 text-sm opacity-80">“{r.comment}”</blockquote>}
                  <figcaption className="mt-3 text-sm font-medium">{r.author}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      );
    case 'faq':
      return (
        <section className="mx-auto max-w-3xl px-6 py-12">
          {p.heading && <h2 className="mb-6 text-2xl font-bold">{p.heading}</h2>}
          <div className="divide-y divide-black/10 rounded-lg border border-black/10">
            {(p.items ?? []).map((it: any, i: number) => (
              <details key={i} className="group p-4">
                <summary className="cursor-pointer font-medium">{it.q}</summary>
                <p className="mt-2 text-sm opacity-80">{it.a}</p>
              </details>
            ))}
          </div>
        </section>
      );
    case 'footer':
      return <footer className="border-t border-black/10 px-6 py-8 text-center text-sm opacity-70">{p.text}</footer>;
    default:
      return null;
  }
}

function Placeholder({ text }: { text: string }) {
  return <div className="mx-6 my-6 rounded-lg border-2 border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{text}</div>;
}

export function PageView({ page, theme, embeds, base, nextPath, preview }: { page: SitePage; theme: SiteTheme; embeds: Embeds; base: string; nextPath: string | null; preview?: boolean }) {
  return (
    <div style={{ backgroundColor: theme.background || '#ffffff', fontFamily: theme.font === 'serif' ? 'Georgia, Cambria, serif' : undefined }} className="text-slate-900">
      {page.blocks.map((b) => (
        <BlockView key={b.id} block={b} theme={theme} embeds={embeds} preview={preview} link={(l) => resolveLink(l, { base, nextPath })} />
      ))}
    </div>
  );
}
