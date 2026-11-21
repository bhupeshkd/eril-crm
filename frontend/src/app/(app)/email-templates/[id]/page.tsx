'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { EMAIL_BLOCK_TYPES, renderEmail, type EmailBlock, type EmailBlockType, type EmailTheme } from '@eril/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Contact, Paged } from '@/lib/types';
import { EditorBar, Modal, PageLoader, PanelTitle, Segmented, TitleInput, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

interface Template {
  id: string;
  name: string;
  subject: string;
  previewText: string;
  theme: EmailTheme;
  blocks: EmailBlock[];
}

const LABELS: Record<EmailBlockType, string> = {
  heading: 'Heading',
  text: 'Text',
  button: 'Button',
  image: 'Image',
  divider: 'Divider',
  spacer: 'Spacer',
  columns: 'Two columns',
  footer: 'Footer',
};
const ICONS: Record<EmailBlockType, string> = { heading: 'note', text: 'file', button: 'pointer', image: 'eye', divider: 'menu', spacer: 'chevronsUpDown', columns: 'panelRight', footer: 'layers' };
const DEFAULTS: Record<EmailBlockType, Record<string, any>> = {
  heading: { text: 'Your headline', size: 'medium', align: 'left' },
  text: { text: 'Write something helpful. Use **bold** and [links](https://example.com).', align: 'left' },
  button: { label: 'Learn more', url: 'https://', align: 'left' },
  image: { url: 'https://', alt: '', width: 536, align: 'center' },
  divider: {},
  spacer: { height: 24 },
  columns: { left: '**Left column**\nText here', right: '**Right column**\nText here' },
  footer: { text: '{{business.name}}' },
};
const MERGE_FIELDS = ['{{contact.firstName}}', '{{contact.lastName}}', '{{contact.email}}', '{{business.name}}'];
const uid = () => Math.random().toString(36).slice(2, 10);

export default function EmailBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { me, can } = useAuth();
  const [t, setT] = useState<Template | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [testing, setTesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const editable = can('campaigns:write');

  useEffect(() => {
    api<Template>(`/email-templates/${id}`).then(setT).catch((e) => toast(errorText(e), 'error'));
  }, [id, toast]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const business = me?.workspaceMemberships.find((m) => m.workspaceId === me.currentWorkspaceId)?.organizationName ?? 'Your business';
  // Same renderer the server uses to send, with sample merge data.
  const rendered = useMemo(() => {
    if (!t) return null;
    const sample: Record<string, string> = { 'contact.firstName': 'Alex', 'contact.lastName': 'Sample', 'contact.email': 'alex@example.com', 'business.name': business };
    return renderEmail(t, { merge: (s) => s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => sample[k] ?? '') });
  }, [t, business]);

  if (!t || !rendered) return <PageLoader />;

  const patch = (p: Partial<Template>) => {
    setT({ ...t, ...p });
    setDirty(true);
  };
  const block = t.blocks.find((b) => b.id === sel) ?? null;
  const setProps = (props: Record<string, any>) => patch({ blocks: t.blocks.map((b) => (b.id === sel ? { ...b, props: { ...b.props, ...props } } : b)) });
  const move = (dir: -1 | 1) => {
    const i = t.blocks.findIndex((b) => b.id === sel);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= t.blocks.length) return;
    const next = [...t.blocks];
    [next[i], next[j]] = [next[j], next[i]];
    patch({ blocks: next });
  };
  const add = (type: EmailBlockType) => {
    const b: EmailBlock = { id: uid(), type, props: { ...DEFAULTS[type] } };
    const i = t.blocks.findIndex((x) => x.id === sel);
    const next = [...t.blocks];
    next.splice(i >= 0 ? i + 1 : next.length, 0, b);
    patch({ blocks: next });
    setSel(b.id);
    setAdding(false);
  };

  async function save() {
    try {
      const saved = await api<Template>(`/email-templates/${id}`, { method: 'PUT', body: { name: t!.name, subject: t!.subject, previewText: t!.previewText, theme: t!.theme, blocks: t!.blocks } });
      setT(saved);
      setDirty(false);
      toast('Template saved');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <EditorBar
        back={{ href: '/campaigns?tab=templates', label: 'Email template' }}
        title={<TitleInput label="Template name" value={t.name} disabled={!editable} onChange={(name) => patch({ name })} />}
        dirty={dirty}
        actions={
          <>
            {can('campaigns:send') && <button className="btn-secondary" onClick={() => (dirty ? toast('Save first, then send a test', 'error') : setTesting(true))}><Icon name="send" /> Send test</button>}
            {editable && <button className="btn-primary" disabled={!dirty} onClick={save}>Save</button>}
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* Outline + settings */}
        <aside className="card w-full shrink-0 overflow-y-auto p-3 lg:w-64" aria-label="Email settings and blocks">
          <fieldset disabled={!editable} className="space-y-2">
            <PanelTitle>Email</PanelTitle>
            <div>
              <label className="mb-0.5 block text-xs text-slate-500" htmlFor="et-subject">Subject line</label>
              <input id="et-subject" className="input py-1.5" value={t.subject} onChange={(e) => patch({ subject: e.target.value })} placeholder="e.g. News from {{business.name}}" />
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-slate-500" htmlFor="et-preview">Preview text (inbox snippet)</label>
              <input id="et-preview" className="input py-1.5" value={t.previewText} onChange={(e) => patch({ previewText: e.target.value })} />
            </div>
            <div className="pt-2"><PanelTitle>Theme</PanelTitle></div>
            <div className="grid grid-cols-2 gap-1.5">
              {([['primaryColor', 'Accent', '#2953e0'], ['background', 'Background', '#f4f4f5'], ['contentBackground', 'Card', '#ffffff'], ['textColor', 'Text', '#1f2937']] as const).map(([k, l, d]) => (
                <label key={k} className="relative flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
                  <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: (t.theme as any)[k] ?? d }} />
                  {l}
                  <input type="color" aria-label={`${l} colour`} className="absolute inset-0 cursor-pointer opacity-0" value={(t.theme as any)[k] ?? d} onChange={(e) => patch({ theme: { ...t.theme, [k]: e.target.value } })} />
                </label>
              ))}
            </div>
            <select aria-label="Font" className="input py-1.5" value={t.theme.font ?? 'sans'} onChange={(e) => patch({ theme: { ...t.theme, font: e.target.value as 'sans' | 'serif' } })}>
              <option value="sans">Sans-serif font</option>
              <option value="serif">Serif font</option>
            </select>
          </fieldset>

          <div className="mt-4" />
          <PanelTitle>Blocks · {t.blocks.length}</PanelTitle>
          <ol className="space-y-0.5">
            {t.blocks.map((b) => (
              <li key={b.id}>
                <button onClick={() => setSel(b.id)} aria-pressed={sel === b.id} className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition ${sel === b.id ? 'bg-brand-50 font-medium text-brand-700 ring-1 ring-inset ring-brand-200/70' : 'text-slate-700 hover:bg-slate-50'}`}>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${sel === b.id ? 'bg-white text-brand-600' : 'bg-slate-100 text-slate-500'}`}><Icon name={ICONS[b.type]} className="h-3.5 w-3.5" /></span>
                  <span className="flex-1 truncate">{String(b.props.text ?? b.props.label ?? b.props.left ?? LABELS[b.type]).split('\n')[0] || LABELS[b.type]}</span>
                </button>
              </li>
            ))}
          </ol>
          {editable && <button className="btn-secondary mt-2 h-8 w-full text-[13px]" onClick={() => setAdding(true)}><Icon name="plus" /> Add block</button>}
        </aside>

        {/* Live preview (sandboxed: no scripts, no same-origin access) */}
        <section className="card flex min-h-[320px] min-w-0 flex-1 flex-col overflow-hidden" aria-label="Preview">
          <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{business.charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1 text-sm">
              <div className="truncate"><span className="font-medium text-slate-900">{business}</span> <span className="text-slate-400">· Inbox preview</span></div>
              <div className="truncate"><span className="font-medium">{rendered.subject || '(no subject)'}</span>{t.previewText && <span className="text-slate-400"> — {t.previewText}</span>}</div>
            </div>
            <Segmented<'desktop' | 'mobile'> label="Preview size" value={device} onChange={setDevice} options={[['desktop', 'Desktop'], ['mobile', 'Mobile']]} />
          </div>
          <div className="flex flex-1 justify-center overflow-auto bg-slate-100 p-4">
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={rendered.html}
              className={`h-full min-h-[600px] bg-white shadow-card transition-all ${device === 'mobile' ? 'rounded-[1.75rem] border-[6px] border-slate-800' : 'rounded-lg'}`}
              style={{ width: device === 'mobile' ? 375 : '100%', maxWidth: 680 }}
            />
          </div>
        </section>

        {/* Block properties */}
        <aside className="card w-full shrink-0 overflow-y-auto p-4 lg:w-72" aria-label="Block settings">
          {!block ? (
            <div className="space-y-4 text-sm text-slate-500">
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-400"><Icon name="pointer" className="h-5 w-5" /></span>
                <p>Select a block on the left to edit it.</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="mb-2 text-xs font-medium text-slate-600">Merge fields</p>
                <ul className="flex flex-wrap gap-1">{MERGE_FIELDS.map((f) => <li key={f}><code className="rounded-md bg-white px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">{f}</code></li>)}</ul>
                <p className="mt-3 text-xs">Formatting: <code className="rounded bg-white px-1 ring-1 ring-slate-200">**bold**</code>, <code className="rounded bg-white px-1 ring-1 ring-slate-200">[label](https://…)</code>, new lines.</p>
              </div>
            </div>
          ) : (
            <fieldset disabled={!editable} className="space-y-3">
              <div className="-mx-4 -mt-4 mb-1 flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Icon name={ICONS[block.type]} className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold">{LABELS[block.type]}</h2>
                  <p className="text-[11px] text-slate-500">Block settings</p>
                </div>
                <div className="flex rounded-lg border border-slate-200">
                  <button type="button" className="btn-ghost h-7 w-7 rounded-r-none px-0" aria-label="Move block up" title="Move up" onClick={() => move(-1)}><Icon name="chevronDown" className="h-4 w-4 rotate-180" /></button>
                  <button type="button" className="btn-ghost h-7 w-7 rounded-l-none border-l border-slate-200 px-0" aria-label="Move block down" title="Move down" onClick={() => move(1)}><Icon name="chevronDown" className="h-4 w-4" /></button>
                </div>
              </div>
              <BlockFields block={block} onChange={setProps} />
              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => {
                  const copy = { ...block, id: uid(), props: { ...block.props } };
                  const i = t.blocks.findIndex((b) => b.id === block.id);
                  const next = [...t.blocks];
                  next.splice(i + 1, 0, copy);
                  patch({ blocks: next });
                  setSel(copy.id);
                }}><Icon name="copy" /> Duplicate</button>
                <button type="button" className="btn-danger flex-1" onClick={() => { patch({ blocks: t.blocks.filter((b) => b.id !== block.id) }); setSel(null); }}><Icon name="trash" /> Remove</button>
              </div>
            </fieldset>
          )}
          {editable && (
            <div className="mt-6 space-y-1 border-t border-slate-100 pt-4">
              <button className="btn-ghost h-8 w-full text-[13px]" onClick={async () => { const d = await api<Template>(`/email-templates/${id}/duplicate`, { method: 'POST' }); router.push(`/email-templates/${d.id}`); }}><Icon name="copy" /> Duplicate template</button>
              <button className="btn-ghost h-8 w-full text-[13px] text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={async () => { if (confirm('Delete this template? Campaigns already sent are not affected.')) { await api(`/email-templates/${id}`, { method: 'DELETE' }); router.push('/campaigns?tab=templates'); } }}>Delete template</button>
            </div>
          )}
        </aside>
      </div>

      <Modal open={adding} title="Add a block" onClose={() => setAdding(false)}>
        <div className="grid grid-cols-2 gap-2">
          {EMAIL_BLOCK_TYPES.map((type) => (
            <button key={type} className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5 text-left text-sm font-medium text-slate-800 transition hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-sm" onClick={() => add(type)}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Icon name={ICONS[type]} className="h-4 w-4" /></span>{LABELS[type]}
            </button>
          ))}
        </div>
      </Modal>
      <Modal open={testing} title="Send a test" onClose={() => setTesting(false)}>
        {testing && <TestSend templateId={id} onDone={(to) => { setTesting(false); toast(`Test sent to ${to}`); }} />}
      </Modal>
    </div>
  );
}

function BlockFields({ block, onChange }: { block: EmailBlock; onChange: (p: Record<string, any>) => void }) {
  const p = block.props;
  const fid = (k: string) => `ef-${block.id}-${k}`;
  const text = (k: string, label: string, rows = 0, placeholder?: string) => (
    <div>
      <label className="mb-0.5 block text-xs text-slate-500" htmlFor={fid(k)}>{label}</label>
      {rows ? (
        <textarea id={fid(k)} rows={rows} className="input" value={p[k] ?? ''} placeholder={placeholder} onChange={(e) => onChange({ [k]: e.target.value })} />
      ) : (
        <input id={fid(k)} className="input" value={p[k] ?? ''} placeholder={placeholder} onChange={(e) => onChange({ [k]: e.target.value })} />
      )}
    </div>
  );
  const alignSel = (
    <div>
      <label className="mb-0.5 block text-xs text-slate-500" htmlFor={fid('align')}>Alignment</label>
      <select id={fid('align')} className="input" value={p.align ?? 'left'} onChange={(e) => onChange({ align: e.target.value })}>
        <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
      </select>
    </div>
  );
  switch (block.type) {
    case 'heading':
      return (
        <>
          {text('text', 'Heading', 2)}
          <div>
            <label className="mb-0.5 block text-xs text-slate-500" htmlFor={fid('size')}>Size</label>
            <select id={fid('size')} className="input" value={p.size ?? 'medium'} onChange={(e) => onChange({ size: e.target.value })}>
              <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
            </select>
          </div>
          {alignSel}
        </>
      );
    case 'text':
      return <>{text('text', 'Text', 8)}{alignSel}</>;
    case 'button':
      return (
        <>
          {text('label', 'Button label')}
          {text('url', 'Link (https://…)', 0, 'https://')}
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="color" className="h-7 w-8 rounded border border-slate-300" value={p.color ?? '#2953e0'} onChange={(e) => onChange({ color: e.target.value })} /> Button colour
          </label>
          {alignSel}
        </>
      );
    case 'image':
      return (
        <>
          {text('url', 'Image URL (https only)', 0, 'https://')}
          {text('alt', 'Alt text (describe the image)')}
          {text('link', 'Link when clicked (optional)', 0, 'https://')}
          <div>
            <label className="mb-0.5 block text-xs text-slate-500" htmlFor={fid('width')}>Width (px, max 536)</label>
            <input id={fid('width')} type="number" min={40} max={536} className="input" value={p.width ?? 536} onChange={(e) => onChange({ width: Number(e.target.value) })} />
          </div>
          {alignSel}
        </>
      );
    case 'spacer':
      return (
        <div>
          <label className="mb-0.5 block text-xs text-slate-500" htmlFor={fid('height')}>Height (px)</label>
          <input id={fid('height')} type="number" min={4} max={120} className="input" value={p.height ?? 24} onChange={(e) => onChange({ height: Number(e.target.value) })} />
        </div>
      );
    case 'columns':
      return <>{text('left', 'Left column', 6)}{text('right', 'Right column', 6)}</>;
    case 'footer':
      return text('text', 'Footer text', 3);
    default:
      return <p className="text-sm text-slate-500">No settings for this block.</p>;
  }
}

function TestSend({ templateId, onDone }: { templateId: string; onDone: (to: string) => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Paged<Contact>>('/crm/contacts?limit=100').then((r) => setContacts(r.items.filter((c) => c.email))).catch(() => {});
  }, []);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        const r = await api(`/email-templates/${templateId}/test`, { method: 'POST', body: { contactId } });
        onDone(r.to);
      } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    }}>
      <p className="text-sm text-slate-600">Sends the saved version with that contact's details merged in. The subject is prefixed with [Test].</p>
      <div>
        <label className="label" htmlFor="ts-c">Send to</label>
        <select id="ts-c" required className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">Choose a contact…</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName} · {c.email}</option>)}
        </select>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end"><button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send test'}</button></div>
    </form>
  );
}
