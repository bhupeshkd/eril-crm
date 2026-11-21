'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { SiteDomains } from '@/components/site-domains';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EditorBar, LiveBadge, Modal, PageLoader, PanelTitle, TitleInput, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

const BLOCK_ICON: Record<string, string> = { hero: 'sparkles', text: 'note', features: 'layers', image: 'eye', video: 'play', cta: 'pointer', form: 'forms', booking: 'calendar', pricing: 'payments', reviews: 'reputation', faq: 'alert', footer: 'menu' };
import { BLOCK_DEFAULTS, BLOCK_LABELS, BlockType, Embeds, PageView, SiteBlock, SitePage, SiteTheme } from '@/components/site-blocks';

interface SiteFull {
  id: string;
  name: string;
  slug: string;
  kind: 'website' | 'funnel';
  theme: SiteTheme;
  pages: SitePage[];
  isPublished: boolean;
  stats: Record<string, number>;
  publicUrl: string;
  preview: { embeds: Embeds };
}

const uid = () => Math.random().toString(36).slice(2, 10);

type FieldSpec = { key: string; label: string; kind?: 'text' | 'textarea' | 'link' | 'form' | 'calendar' | 'items-features' | 'items-faq' };
const FIELDS: Record<BlockType, FieldSpec[]> = {
  hero: [{ key: 'heading', label: 'Heading' }, { key: 'subheading', label: 'Subheading', kind: 'textarea' }, { key: 'buttonText', label: 'Button text' }, { key: 'buttonLink', label: 'Button link', kind: 'link' }, { key: 'image', label: 'Image URL' }],
  text: [{ key: 'heading', label: 'Heading' }, { key: 'body', label: 'Text', kind: 'textarea' }],
  features: [{ key: 'heading', label: 'Heading' }, { key: 'items', label: 'Items', kind: 'items-features' }],
  image: [{ key: 'imageUrl', label: 'Image URL (https://…)' }, { key: 'alt', label: 'Alt text (describe the image)' }],
  video: [{ key: 'videoUrl', label: 'YouTube or Vimeo URL' }],
  cta: [{ key: 'heading', label: 'Heading' }, { key: 'buttonText', label: 'Button text' }, { key: 'buttonLink', label: 'Button link', kind: 'link' }],
  form: [{ key: 'formId', label: 'Form', kind: 'form' }],
  booking: [{ key: 'calendarId', label: 'Calendar', kind: 'calendar' }],
  pricing: [{ key: 'heading', label: 'Heading' }],
  reviews: [{ key: 'heading', label: 'Heading' }],
  faq: [{ key: 'heading', label: 'Heading' }, { key: 'items', label: 'Questions', kind: 'items-faq' }],
  footer: [{ key: 'text', label: 'Footer text' }],
};

export default function SiteBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [site, setSite] = useState<SiteFull | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [blockId, setBlockId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [domainsOpen, setDomainsOpen] = useState(false);
  const editable = can('websites:write');

  useEffect(() => {
    api<SiteFull>(`/sites/${id}`).then(setSite).catch((e) => toast(errorText(e), 'error'));
  }, [id, toast]);

  if (!site) return <PageLoader />;
  const page = site.pages[pageIdx] ?? site.pages[0];
  const block = page.blocks.find((b) => b.id === blockId) ?? null;

  const patchSite = (p: Partial<SiteFull>) => {
    setSite({ ...site, ...p });
    setDirty(true);
  };
  const patchPage = (p: Partial<SitePage>) => patchSite({ pages: site.pages.map((x, i) => (i === pageIdx ? { ...x, ...p } : x)) });
  const patchBlock = (props: Record<string, any>) => patchPage({ blocks: page.blocks.map((b) => (b.id === blockId ? { ...b, props: { ...b.props, ...props } } : b)) });
  const moveBlock = (dir: -1 | 1) => {
    const i = page.blocks.findIndex((b) => b.id === blockId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= page.blocks.length) return;
    const next = [...page.blocks];
    [next[i], next[j]] = [next[j], next[i]];
    patchPage({ blocks: next });
  };

  async function save(extra: Partial<SiteFull> = {}) {
    setSaving(true);
    try {
      const saved = await api<SiteFull>(`/sites/${id}`, {
        method: 'PUT',
        body: { name: site!.name, kind: site!.kind, theme: site!.theme, pages: site!.pages, ...('isPublished' in extra ? { isPublished: extra.isPublished } : {}) },
      });
      setSite({ ...site!, ...saved, preview: site!.preview, publicUrl: site!.publicUrl });
      setDirty(false);
      toast('isPublished' in extra ? (extra.isPublished ? 'Site published' : 'Site unpublished') : 'Site saved');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  const nextPath = site.kind === 'funnel' && pageIdx < site.pages.length - 1 ? site.pages[pageIdx + 1].path : null;
  const views = (p: SitePage) => site.stats?.[p.path || '/'] ?? 0;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <EditorBar
        back={{ href: '/sites', label: 'Sites & Funnels' }}
        title={<TitleInput label="Site name" value={site.name} disabled={!editable} onChange={(name) => patchSite({ name })} />}
        status={<LiveBadge on={site.isPublished} onLabel="Published" />}
        dirty={dirty}
        actions={
          <>
            <div className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 shadow-sm">
              <select aria-label="Site type" className="h-7 cursor-pointer rounded-md bg-transparent px-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 focus:outline-none" value={site.kind} disabled={!editable} onChange={(e) => patchSite({ kind: e.target.value as SiteFull['kind'] })}>
                <option value="website">Website</option>
                <option value="funnel">Funnel</option>
              </select>
              <span className="h-5 w-px bg-slate-200" />
              <select aria-label="Font" className="h-7 cursor-pointer rounded-md bg-transparent px-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 focus:outline-none" value={site.theme.font ?? 'sans'} disabled={!editable} onChange={(e) => patchSite({ theme: { ...site.theme, font: e.target.value as 'sans' | 'serif' } })}>
                <option value="sans">Sans-serif</option>
                <option value="serif">Serif</option>
              </select>
              <span className="h-5 w-px bg-slate-200" />
              <label className="relative grid h-7 w-7 cursor-pointer place-items-center rounded-md hover:bg-slate-50" title="Brand colour">
                <span className="h-4 w-4 rounded-full ring-2 ring-white ring-offset-1 ring-offset-slate-200" style={{ background: site.theme.primaryColor ?? '#2953e0' }} />
                <input type="color" aria-label="Brand colour" className="absolute inset-0 cursor-pointer opacity-0" value={site.theme.primaryColor ?? '#2953e0'} disabled={!editable} onChange={(e) => patchSite({ theme: { ...site.theme, primaryColor: e.target.value } })} />
              </label>
            </div>
            {site.kind === 'website' && <Link className="btn-secondary" href={`/sites/${id}/blog`}><Icon name="file" /> Blog</Link>}
            <button className="btn-secondary" onClick={() => setDomainsOpen(true)}><Icon name="external" /> Domains</button>
            {site.isPublished && <a className="btn-secondary" href={`/s/${site.slug}${page.path ? `/${page.path}` : ''}`} target="_blank" rel="noreferrer"><Icon name="external" /> View live</a>}
            {editable && <button className="btn-secondary" disabled={saving} onClick={() => save({ isPublished: !site.isPublished })}>{site.isPublished ? 'Unpublish' : 'Publish'}</button>}
            {editable && <button className="btn-primary" disabled={saving || !dirty} onClick={() => save()}>Save</button>}
          </>
        }
      />

      {domainsOpen && <SiteDomains siteId={id} published={site.isPublished} canEdit={can('websites:publish')} onClose={() => setDomainsOpen(false)} />}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* Pages + blocks */}
        <aside className="card w-full shrink-0 overflow-y-auto p-3 lg:w-60" aria-label="Pages and blocks">
          <PanelTitle>{site.kind === 'funnel' ? 'Funnel steps' : 'Pages'}</PanelTitle>
          <ol className="space-y-0.5">
            {site.pages.map((p, i) => (
              <li key={p.id}>
                <button onClick={() => { setPageIdx(i); setBlockId(null); }} aria-current={i === pageIdx} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition ${i === pageIdx ? 'bg-brand-50 font-medium text-brand-700 ring-1 ring-inset ring-brand-200/70' : 'text-slate-700 hover:bg-slate-50'}`}>
                  {site.kind === 'funnel' ? (
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${i === pageIdx ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                  ) : (
                    <Icon name="file" className="h-4 w-4 shrink-0 text-slate-400" />
                  )}
                  <span className="flex-1 truncate">{p.title}</span>
                  <span className="flex items-center gap-1 text-[11px] text-slate-400" title="Views"><Icon name="eye" className="h-3 w-3" />{views(p)}</span>
                </button>
              </li>
            ))}
          </ol>
          {editable && (
            <button className="btn-ghost mt-1 h-8 w-full justify-start text-[13px] text-brand-600 hover:bg-brand-50 hover:text-brand-700" onClick={() => {
              const n = site.pages.length + 1;
              patchSite({ pages: [...site.pages, { id: uid(), title: `Page ${n}`, path: `page-${n}`, blocks: [{ id: uid(), type: 'text', props: { ...BLOCK_DEFAULTS.text } }] }] });
              setPageIdx(site.pages.length);
            }}><Icon name="plus" /> Add {site.kind === 'funnel' ? 'step' : 'page'}</button>
          )}

          <fieldset disabled={!editable} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
            <div>
              <label className="mb-0.5 block text-xs text-slate-500" htmlFor="pg-title">Page title</label>
              <input id="pg-title" className="input py-1.5" value={page.title} onChange={(e) => patchPage({ title: e.target.value })} />
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-slate-500" htmlFor="pg-path">URL path {pageIdx === 0 && '(home)'}</label>
              <input id="pg-path" className="input py-1.5 font-mono text-xs" placeholder="(home)" value={page.path} onChange={(e) => patchPage({ path: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
            </div>
            {site.pages.length > 1 && (
              <div className="flex items-center gap-1">
                <button type="button" className="btn-ghost h-7 w-7 px-0" aria-label="Move page up" title="Move up" onClick={() => { if (pageIdx > 0) { const n = [...site.pages]; [n[pageIdx - 1], n[pageIdx]] = [n[pageIdx], n[pageIdx - 1]]; patchSite({ pages: n }); setPageIdx(pageIdx - 1); } }}><Icon name="chevronDown" className="h-4 w-4 rotate-180" /></button>
                <button type="button" className="btn-ghost h-7 w-7 px-0" aria-label="Move page down" title="Move down" onClick={() => { if (pageIdx < site.pages.length - 1) { const n = [...site.pages]; [n[pageIdx + 1], n[pageIdx]] = [n[pageIdx], n[pageIdx + 1]]; patchSite({ pages: n }); setPageIdx(pageIdx + 1); } }}><Icon name="chevronDown" className="h-4 w-4" /></button>
                <button type="button" className="btn-ghost ml-auto h-7 px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => { if (confirm(`Delete page "${page.title}"?`)) { patchSite({ pages: site.pages.filter((_, i) => i !== pageIdx) }); setPageIdx(0); } }}>Delete page</button>
              </div>
            )}
          </fieldset>

          <div className="mt-4" />
          <PanelTitle>Blocks · {page.blocks.length}</PanelTitle>
          <ul className="space-y-0.5">
            {page.blocks.map((b) => (
              <li key={b.id}>
                <button onClick={() => setBlockId(b.id)} aria-pressed={blockId === b.id} className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition ${blockId === b.id ? 'bg-brand-50 font-medium text-brand-700 ring-1 ring-inset ring-brand-200/70' : 'text-slate-700 hover:bg-slate-50'}`}>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${blockId === b.id ? 'bg-white text-brand-600' : 'bg-slate-100 text-slate-500'}`}><Icon name={BLOCK_ICON[b.type] ?? 'layers'} className="h-3.5 w-3.5" /></span>
                  {BLOCK_LABELS[b.type]}
                </button>
              </li>
            ))}
          </ul>
          {editable && <button className="btn-secondary mt-2 h-8 w-full text-[13px]" onClick={() => setAdding(true)}><Icon name="plus" /> Add block</button>}
        </aside>

        {/* Live preview */}
        <section className="card min-h-[300px] min-w-0 flex-1 overflow-y-auto" aria-label="Preview">
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-slate-50/95 px-3 py-2 text-xs text-slate-500 backdrop-blur">
            <span className="flex gap-1.5" aria-hidden><span className="h-2.5 w-2.5 rounded-full bg-rose-300" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-300" /></span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1">
              <Icon name="lock" className="h-3 w-3 shrink-0 text-slate-400" />
              <span className="truncate">{site.publicUrl}{page.path ? `/${page.path}` : ''}</span>
            </span>
          </div>
          <div onClick={(e) => {
            const el = (e.target as HTMLElement).closest('[data-block]');
            if (el) setBlockId(el.getAttribute('data-block'));
          }}>
            {page.blocks.map((b) => (
              <div key={b.id} data-block={b.id} className={`relative cursor-pointer outline-offset-[-2px] ${b.id === blockId ? 'outline outline-2 outline-brand-500' : 'hover:outline hover:outline-1 hover:outline-brand-300'}`}>
                <PageView page={{ ...page, blocks: [b] }} theme={site.theme} embeds={site.preview.embeds} base={`/s/${site.slug}`} nextPath={nextPath} preview />
              </div>
            ))}
            {page.blocks.length === 0 && <p className="p-10 text-center text-sm text-slate-500">This page is empty — add a block.</p>}
          </div>
        </section>

        {/* Block settings */}
        <aside className="card w-full shrink-0 overflow-y-auto p-4 lg:w-72" aria-label="Block settings">
          {!block ? (
            <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-400"><Icon name="pointer" className="h-5 w-5" /></span>
              <p className="text-sm text-slate-500">Click a block in the preview to edit it.</p>
            </div>
          ) : (
            <fieldset disabled={!editable} className="space-y-3">
              <div className="-mx-4 -mt-4 mb-1 flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Icon name={BLOCK_ICON[block.type] ?? 'layers'} className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold">{BLOCK_LABELS[block.type]}</h2>
                  <p className="text-[11px] text-slate-500">Block settings</p>
                </div>
                <div className="flex rounded-lg border border-slate-200">
                  <button type="button" className="btn-ghost h-7 w-7 rounded-r-none px-0" aria-label="Move block up" title="Move up" onClick={() => moveBlock(-1)}><Icon name="chevronDown" className="h-4 w-4 rotate-180" /></button>
                  <button type="button" className="btn-ghost h-7 w-7 rounded-l-none border-l border-slate-200 px-0" aria-label="Move block down" title="Move down" onClick={() => moveBlock(1)}><Icon name="chevronDown" className="h-4 w-4" /></button>
                </div>
              </div>
              {FIELDS[block.type].map((f) => (
                <BlockField key={f.key} spec={f} block={block} embeds={site.preview.embeds} onChange={patchBlock} kind={site.kind} pages={site.pages} />
              ))}
              <button type="button" className="btn-danger w-full" onClick={() => { patchPage({ blocks: page.blocks.filter((b) => b.id !== block.id) }); setBlockId(null); }}><Icon name="trash" /> Remove block</button>
            </fieldset>
          )}
          {editable && (
            <button className="btn-ghost mt-6 w-full text-[13px] text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={async () => { if (confirm('Delete this site?')) { await api(`/sites/${id}`, { method: 'DELETE' }); router.push('/sites'); } }}>Delete site</button>
          )}
        </aside>
      </div>

      <Modal open={adding} title="Add a block" onClose={() => setAdding(false)}>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(BLOCK_LABELS) as BlockType[]).map((t) => (
            <button key={t} className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5 text-left text-sm font-medium text-slate-800 transition hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-sm" onClick={() => {
              const b: SiteBlock = { id: uid(), type: t, props: JSON.parse(JSON.stringify(BLOCK_DEFAULTS[t])) };
              const i = page.blocks.findIndex((x) => x.id === blockId);
              const blocks = [...page.blocks];
              blocks.splice(i >= 0 ? i + 1 : blocks.length, 0, b);
              patchPage({ blocks });
              setBlockId(b.id);
              setAdding(false);
            }}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Icon name={BLOCK_ICON[t] ?? 'layers'} className="h-4 w-4" /></span>{BLOCK_LABELS[t]}</button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function BlockField({ spec, block, embeds, onChange, kind, pages }: { spec: FieldSpec; block: SiteBlock; embeds: Embeds; onChange: (p: Record<string, any>) => void; kind: 'website' | 'funnel'; pages: SitePage[] }) {
  const v = block.props[spec.key];
  const fid = `bf-${block.id}-${spec.key}`;
  const label = <label className="mb-0.5 block text-xs text-slate-500" htmlFor={fid}>{spec.label}</label>;
  switch (spec.kind) {
    case 'textarea':
      return <div>{label}<textarea id={fid} rows={4} className="input" value={v ?? ''} onChange={(e) => onChange({ [spec.key]: e.target.value })} /></div>;
    case 'link':
      return (
        <div>
          {label}
          <input id={fid} list={`${fid}-opts`} className="input" value={v ?? ''} placeholder="next, /contact or https://…" onChange={(e) => onChange({ [spec.key]: e.target.value })} />
          <datalist id={`${fid}-opts`}>
            {kind === 'funnel' && <option value="next">Next funnel step</option>}
            {pages.map((p) => <option key={p.id} value={`/${p.path}`}>{p.title}</option>)}
          </datalist>
          <p className="mt-1 text-xs text-slate-400">{kind === 'funnel' ? '“next” goes to the next step. ' : ''}Use /path for a page on this site.</p>
        </div>
      );
    case 'form':
    case 'calendar': {
      const list = spec.kind === 'form' ? embeds.forms : embeds.calendars;
      return (
        <div>
          {label}
          <select id={fid} className="input" value={v ?? ''} onChange={(e) => onChange({ [spec.key]: e.target.value || undefined })}>
            <option value="">{list.length ? `First ${spec.kind}` : `No ${spec.kind}s yet`}</option>
            {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
      );
    }
    case 'items-features':
    case 'items-faq': {
      const items: any[] = v ?? [];
      const [a, b] = spec.kind === 'items-faq' ? ['q', 'a'] : ['title', 'body'];
      const set = (i: number, p: any) => onChange({ [spec.key]: items.map((x, j) => (j === i ? { ...x, ...p } : x)) });
      return (
        <fieldset>
          <legend className="mb-1 text-xs text-slate-500">{spec.label}</legend>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="space-y-1 rounded border border-slate-200 p-2">
                <input aria-label={`${spec.label} ${i + 1} ${a === 'q' ? 'question' : 'title'}`} className="input py-1" value={it[a] ?? ''} onChange={(e) => set(i, { [a]: e.target.value })} />
                <textarea aria-label={`${spec.label} ${i + 1} ${b === 'a' ? 'answer' : 'text'}`} rows={2} className="input py-1" value={it[b] ?? ''} onChange={(e) => set(i, { [b]: e.target.value })} />
                <button type="button" className="text-xs text-rose-600" onClick={() => onChange({ [spec.key]: items.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            ))}
          </div>
          <button type="button" className="btn-ghost mt-1 px-2 py-1 text-xs" onClick={() => onChange({ [spec.key]: [...items, { [a]: '', [b]: '' }] })}>+ Add</button>
        </fieldset>
      );
    }
    default:
      return <div>{label}<input id={fid} className="input" value={v ?? ''} onChange={(e) => onChange({ [spec.key]: e.target.value })} /></div>;
  }
}
