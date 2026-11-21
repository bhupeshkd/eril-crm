'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CustomField, FormField, FormT, Submission } from '@/lib/types-ext';
import { FormRenderer } from '@/components/form-renderer';
import { EditorBar, EmptyState, LiveBadge, PageLoader, PanelTitle, Tabs, TitleInput, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

const FIELD_ICON: Record<string, string> = { email: 'mail', phone: 'phone', date: 'calendar', number: 'reporting', textarea: 'note', select: 'chevronsUpDown', radio: 'dot', checkbox: 'tasks' };

const TYPES: FormField['type'][] = ['text', 'email', 'phone', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox'];
const MAP: Array<[string, string]> = [
  ['none', "Don't save to contact"],
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['companyName', 'Company'],
];

const keyFrom = (label: string, taken: string[]) => {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1') || 'field';
  base = base.slice(0, 50);
  let k = base;
  for (let i = 2; taken.includes(k); i++) k = `${base}_${i}`;
  return k;
};

export default function FormBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [form, setForm] = useState<FormT | null>(null);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [tab, setTab] = useState<'build' | 'settings' | 'share' | 'submissions'>('build');
  const [subs, setSubs] = useState<Submission[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    api<FormT>(`/forms/${id}`).then(setForm).catch((e) => toast(errorText(e), 'error'));
    api<CustomField[]>('/crm/custom-fields').then(setCustomFields).catch(() => {});
  }, [id, toast]);
  useEffect(() => {
    if (tab === 'submissions') api<Submission[]>(`/forms/${id}/submissions`).then(setSubs).catch((e) => toast(errorText(e), 'error'));
  }, [tab, id, toast]);

  if (!form) return <PageLoader />;
  const editable = can('forms:write');
  const patch = (p: Partial<FormT>) => {
    setForm({ ...form, ...p });
    setDirty(true);
  };
  const setField = (i: number, p: Partial<FormField>) => patch({ fields: form.fields.map((f, j) => (j === i ? { ...f, ...p } : f)) });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= form.fields.length) return;
    const next = [...form.fields];
    [next[i], next[j]] = [next[j], next[i]];
    patch({ fields: next });
    setSel(j);
  };
  const addField = () => {
    const key = keyFrom('New question', form.fields.map((f) => f.key));
    patch({ fields: [...form.fields, { key, label: 'New question', type: 'text', mapTo: 'none' }] });
    setSel(form.fields.length);
  };

  async function save() {
    try {
      const saved = await api<FormT>(`/forms/${id}`, {
        method: 'PUT',
        body: { name: form!.name, kind: form!.kind, description: form!.description, fields: form!.fields, settings: form!.settings, isActive: form!.isActive },
      });
      setForm({ ...form!, ...saved });
      setDirty(false);
      toast('Form saved');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  const f = form.fields[sel];
  const embedCode = `<iframe src="${form.publicUrl}?embed=1" style="width:100%;min-height:640px;border:0" title="${form.name.replace(/"/g, '')}"></iframe>`;

  return (
    <>
      <EditorBar
        back={{ href: '/forms', label: form.kind === 'survey' ? 'Survey' : 'Form' }}
        title={<TitleInput label="Form name" value={form.name} disabled={!editable} onChange={(name) => patch({ name })} />}
        status={<LiveBadge on={form.isActive} offLabel="Off" />}
        dirty={dirty}
        actions={
          <>
            <a className="btn-secondary" href={`/f/${form.slug}`} target="_blank" rel="noreferrer"><Icon name="eye" /> Preview</a>
            {editable && <button className="btn-primary" disabled={!dirty} onClick={save}>Save</button>}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[['build', 'Build'], ['settings', 'Settings'], ['share', 'Share & embed'], ['submissions', 'Submissions', form.submissionCount]]}
      />

      {tab === 'build' && (
        <div className="grid gap-4 lg:grid-cols-[250px_1fr_320px]">
          <section className="card self-start p-3" aria-label="Fields">
            <PanelTitle>Fields · {form.fields.length}</PanelTitle>
            <ul className="space-y-0.5">
              {form.fields.map((x, i) => (
                <li key={x.key}>
                  <button onClick={() => setSel(i)} aria-pressed={sel === i} className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition ${sel === i ? 'bg-brand-50 font-medium text-brand-700 ring-1 ring-inset ring-brand-200/70' : 'text-slate-700 hover:bg-slate-50'}`}>
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${sel === i ? 'bg-white text-brand-600' : 'bg-slate-100 text-slate-500'}`}><Icon name={FIELD_ICON[x.type] ?? 'pencil'} className="h-3.5 w-3.5" /></span>
                    <span className="flex-1 truncate">{x.label}</span>
                    {x.required && <span className="text-rose-500" aria-label="Required">*</span>}
                  </button>
                </li>
              ))}
            </ul>
            {editable && <button className="btn-secondary mt-3 h-8 w-full text-[13px]" onClick={addField}><Icon name="plus" /> Add field</button>}
          </section>

          <section className="card overflow-hidden" aria-label="Preview">
            <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              <Icon name="eye" className="h-3.5 w-3.5" /> Live preview
            </div>
            <div className="mx-auto max-w-xl p-6 sm:p-8">
              <h2 className="text-xl font-semibold tracking-tight">{form.name}</h2>
              {form.description && <p className="mb-5 mt-1 text-sm text-slate-600">{form.description}</p>}
              <FormRenderer key={JSON.stringify(form.fields) + form.kind} fields={form.fields} kind={form.kind} submitText={form.settings.submitText} color={form.settings.color} />
            </div>
          </section>

          <aside className="card self-start p-4" aria-label="Field settings">
            {!f ? <p className="py-6 text-center text-sm text-slate-500">Add a field to get started.</p> : (
              <fieldset disabled={!editable} className="space-y-3">
                <PanelTitle>Field settings</PanelTitle>
                <div>
                  <label className="label" htmlFor="fb-label">Label</label>
                  <input id="fb-label" className="input" value={f.label} onChange={(e) => setField(sel, { label: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="fb-type">Type</label>
                  <select id="fb-type" className="input" value={f.type} onChange={(e) => setField(sel, { type: e.target.value as FormField['type'], options: ['select', 'radio', 'checkbox'].includes(e.target.value) ? f.options?.length ? f.options : ['Option 1', 'Option 2'] : undefined })}>
                    {TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                {['select', 'radio', 'checkbox'].includes(f.type) && (
                  <div>
                    <label className="label" htmlFor="fb-opts">Options (one per line)</label>
                    <textarea id="fb-opts" rows={4} className="input" value={(f.options ?? []).join('\n')} onChange={(e) => setField(sel, { options: e.target.value.split('\n') })} onBlur={(e) => setField(sel, { options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="fb-ph">Placeholder</label>
                  <input id="fb-ph" className="input" value={f.placeholder ?? ''} onChange={(e) => setField(sel, { placeholder: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="fb-map">Save answer to contact</label>
                  <select id="fb-map" className="input" value={f.mapTo ?? 'none'} onChange={(e) => setField(sel, { mapTo: e.target.value })}>
                    {MAP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    {customFields.map((c) => <option key={c.key} value={`custom:${c.key}`}>Custom: {c.label}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">Map an Email or Phone field so submissions create/update a contact.</p>
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.required} onChange={(e) => setField(sel, { required: e.target.checked })} /> Required</label>
                <p className="text-xs text-slate-400">Key: <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-600">{f.key}</code></p>
                <div className="flex items-center gap-1 border-t border-slate-100 pt-3">
                  <button type="button" className="btn-secondary h-8 w-8 px-0" aria-label="Move up" title="Move up" onClick={() => move(sel, -1)}><Icon name="chevronDown" className="h-4 w-4 rotate-180" /></button>
                  <button type="button" className="btn-secondary h-8 w-8 px-0" aria-label="Move down" title="Move down" onClick={() => move(sel, 1)}><Icon name="chevronDown" className="h-4 w-4" /></button>
                  <button type="button" className="btn-danger ml-auto h-8 text-[13px]" onClick={() => { patch({ fields: form.fields.filter((_, j) => j !== sel) }); setSel(Math.max(0, sel - 1)); }}><Icon name="trash" className="h-3.5 w-3.5" /> Delete</button>
                </div>
              </fieldset>
            )}
          </aside>
        </div>
      )}

      {tab === 'settings' && (
        <fieldset disabled={!editable} className="card max-w-2xl space-y-4 p-6">
          <div>
            <label className="label" htmlFor="fs-kind">Layout</label>
            <select id="fs-kind" className="input" value={form.kind} onChange={(e) => patch({ kind: e.target.value as 'form' | 'survey' })}>
              <option value="form">Form — all fields on one page</option>
              <option value="survey">Survey — one question per step</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="fs-desc">Intro text</label>
            <textarea id="fs-desc" rows={2} className="input" value={form.description} onChange={(e) => patch({ description: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="fs-btn">Button text</label>
              <input id="fs-btn" className="input" value={form.settings.submitText ?? ''} onChange={(e) => patch({ settings: { ...form.settings, submitText: e.target.value } })} />
            </div>
            <div>
              <label className="label" htmlFor="fs-color">Button colour</label>
              <input id="fs-color" type="color" className="h-[38px] w-full cursor-pointer rounded-lg border border-slate-200 bg-white p-1 shadow-sm" value={form.settings.color ?? '#2953e0'} onChange={(e) => patch({ settings: { ...form.settings, color: e.target.value } })} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="fs-msg">Thank-you message</label>
            <input id="fs-msg" className="input" value={form.settings.successMessage ?? ''} onChange={(e) => patch({ settings: { ...form.settings, successMessage: e.target.value } })} />
          </div>
          <div>
            <label className="label" htmlFor="fs-redir">Redirect URL after submit (optional)</label>
            <input id="fs-redir" type="url" className="input" placeholder="https://" value={form.settings.redirectUrl ?? ''} onChange={(e) => patch({ settings: { ...form.settings, redirectUrl: e.target.value } })} />
          </div>
          <div>
            <label className="label" htmlFor="fs-tags">Tag new contacts (comma separated)</label>
            <input id="fs-tags" className="input" value={(form.settings.tags ?? []).join(', ')} onChange={(e) => patch({ settings: { ...form.settings, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) } })} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => patch({ isActive: e.target.checked })} /> Accepting responses</label>
          {editable && (
            <div className="border-t border-slate-100 pt-4">
              <button type="button" className="btn-danger" onClick={async () => { if (confirm('Delete this form?')) { await api(`/forms/${id}`, { method: 'DELETE' }); router.push('/forms'); } }}><Icon name="trash" /> Delete form</button>
            </div>
          )}
        </fieldset>
      )}

      {tab === 'share' && (
        <div className="card max-w-2xl space-y-5 p-6">
          <div>
            <h3 className="label">Direct link</h3>
            <div className="flex gap-2">
              <input readOnly aria-label="Public link" className="input bg-slate-50 text-slate-600" value={form.publicUrl} />
              <button className="btn-secondary" onClick={() => { navigator.clipboard.writeText(form.publicUrl!); toast('Link copied'); }}><Icon name="copy" /> Copy</button>
            </div>
          </div>
          <div>
            <h3 className="label">Embed on your website</h3>
            <textarea readOnly aria-label="Embed code" rows={3} className="input bg-slate-900 font-mono text-xs text-slate-100 hover:border-slate-700" value={embedCode} />
            <button className="btn-secondary mt-2" onClick={() => { navigator.clipboard.writeText(embedCode); toast('Embed code copied'); }}><Icon name="copy" /> Copy embed code</button>
          </div>
          <p className="flex items-start gap-2 rounded-lg bg-brand-50/70 px-3 py-2.5 text-sm text-brand-900"><Icon name="automation" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /><span>Tip: create an automation with the trigger <strong>Form is submitted</strong> to follow up instantly.</span></p>
        </div>
      )}

      {tab === 'submissions' && (
        !subs ? <PageLoader /> : subs.length === 0 ? <EmptyState title="No submissions yet">Share the form link or embed it on your site. Responses will appear here.</EmptyState> : (
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5">Submitted</th>
                  <th className="px-4 py-2.5">Contact</th>
                  {form.fields.map((x) => <th key={x.key} className="px-4 py-2.5">{x.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {subs.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(s.createdAt)}</td>
                    <td className="px-4 py-3">{s.contact ? <Link className="font-medium text-slate-900 hover:text-brand-600" href={`/contacts/${s.contact.id}`}>{s.contact.firstName} {s.contact.lastName}</Link> : '—'}</td>
                    {form.fields.map((x) => <td key={x.key} className="max-w-xs truncate px-4 py-3">{Array.isArray(s.data[x.key]) ? s.data[x.key].join(', ') : String(s.data[x.key] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}
