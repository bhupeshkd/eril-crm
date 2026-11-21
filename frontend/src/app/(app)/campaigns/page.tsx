'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AbTest, Campaign } from '@/lib/types-ext';
import { EmptyState, Modal, PageHeader, Spinner, StatusBadge, errorText, useToast } from '@/components/ui';
import { AiButton, useAiEnabled } from '@/lib/ai';
import { EmailTemplatesTab, type TemplateRow } from '@/components/email-templates-tab';
import { CampaignReport } from '@/components/campaign-report';
import { AbPanel } from '@/components/ab-panel';
import { Icon } from '@/components/icons';

type StatusFilter = 'all' | 'draft' | 'scheduled' | 'active' | 'sent';

/** Thin meter for open/click rates. */
function Meter({ value, tone = 'bg-brand-500' }: { value: number | null | undefined; tone?: string }) {
  if (value == null) return <span className="text-slate-300">—</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, value)}%` }} /></span>
      <span className="w-11 text-right text-[13px] font-medium tabular-nums">{value}%</span>
    </span>
  );
}

export default function CampaignsPage() {
  const toast = useToast();
  const { can } = useAuth();
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const [tab, setTab] = useState<'campaigns' | 'templates'>('campaigns');

  // Deep link: /campaigns?tab=templates
  useEffect(() => {
    if (new URLSearchParams(location.search).get('tab') === 'templates') setTab('templates');
  }, []);
  const switchTab = (t: 'campaigns' | 'templates') => {
    setTab(t);
    history.replaceState(null, '', t === 'templates' ? '/campaigns?tab=templates' : '/campaigns');
  };

  const load = useCallback(() => api<Campaign[]>('/campaigns').then(setItems).catch((e) => toast(errorText(e), 'error')), [toast]);
  useEffect(() => {
    load();
  }, [load]);
  // Poll while any campaign is sending (fast) or waiting on an A/B result (slow).
  useEffect(() => {
    const sending = items?.some((c) => c.status === 'sending');
    if (!sending && !items?.some((c) => c.status === 'testing')) return;
    const t = setInterval(load, sending ? 2000 : 15000);
    return () => clearInterval(t);
  }, [items, load]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [channel, setChannel] = useState<'' | 'email' | 'sms'>('');
  const shown = useMemo(
    () =>
      (items ?? []).filter((c) => {
        if (channel && c.channel !== channel) return false;
        if (status === 'active' && !['sending', 'testing'].includes(c.status)) return false;
        if (!['all', 'active'].includes(status) && c.status !== status) return false;
        const t = q.trim().toLowerCase();
        return !t || c.name.toLowerCase().includes(t) || (c.subject ?? '').toLowerCase().includes(t);
      }),
    [items, q, status, channel],
  );
  const summary = useMemo(() => {
    const sent = (items ?? []).filter((c) => ['sent', 'testing'].includes(c.status));
    const rates = (k: 'openRate' | 'clickRate') => {
      const v = sent.map((c) => c[k]).filter((x): x is number => x != null);
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
    };
    return { sent: sent.length, delivered: sent.reduce((t, c) => t + (c.stats?.sent ?? 0), 0), open: rates('openRate'), click: rates('clickRate'), scheduled: (items ?? []).filter((c) => c.status === 'scheduled').length };
  }, [items]);

  return (
    <>
      <PageHeader
        title="Marketing"
        subtitle="Email and SMS campaigns to segments of your contacts, and reusable email designs"
        actions={tab === 'campaigns' && can('campaigns:write') && <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" /> New campaign</button>}
      />
      <div className="mb-5 flex w-fit gap-1 rounded-xl bg-slate-200/60 p-1" role="tablist">
        {([['campaigns', 'Campaigns', 'marketing', items?.length], ['templates', 'Email templates', 'mail', undefined]] as const).map(([t, l, icon, n]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => switchTab(t)} className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition ${tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            <Icon name={icon} className={`h-4 w-4 ${tab === t ? 'text-brand-600' : ''}`} />
            {l}
            {!!n && <span className={`rounded-full px-1.5 text-[10px] font-semibold leading-4 ${tab === t ? 'bg-brand-100 text-brand-700' : 'bg-slate-300/60 text-slate-600'}`}>{n}</span>}
          </button>
        ))}
      </div>
      {tab === 'templates' ? <EmailTemplatesTab /> : !items ? <div className="grid h-48 place-items-center"><Spinner /></div> : items.length === 0 ? (
        <EmptyState title="No campaigns yet">Send a newsletter or promotion to leads and customers. Contacts on do-not-disturb are skipped automatically.</EmptyState>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Campaigns sent', value: String(summary.sent), hint: summary.scheduled ? `${summary.scheduled} scheduled` : `${items.length} total`, icon: 'marketing', tint: 'from-brand-500 to-brand-700' },
              { label: 'Messages delivered', value: summary.delivered.toLocaleString(), hint: 'across sent campaigns', icon: 'send', tint: 'from-sky-500 to-indigo-500' },
              { label: 'Average open rate', value: summary.open == null ? '—' : `${summary.open}%`, hint: 'designed emails only', icon: 'eye', tint: 'from-emerald-500 to-teal-500' },
              { label: 'Average click rate', value: summary.click == null ? '—' : `${summary.click}%`, hint: 'scanner clicks excluded', icon: 'pointer', tint: 'from-amber-500 to-orange-500' },
            ].map((k) => (
              <div key={k.label} className="card flex items-center gap-4 px-4 py-3.5">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${k.tint} text-white shadow-sm`}><Icon name={k.icon} className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-slate-500">{k.label}</div>
                  <div className="text-xl font-semibold leading-tight tracking-tight tabular-nums">{k.value}</div>
                  <div className="truncate text-[11px] text-slate-400">{k.hint}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" aria-label="Search campaigns" placeholder="Search campaigns…" className="input h-9 pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-200/60 p-1" role="tablist" aria-label="Status">
              {([['all', 'All'], ['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['active', 'In progress'], ['sent', 'Sent']] as const).map(([v, l]) => (
                <button key={v} role="tab" aria-selected={status === v} onClick={() => setStatus(v)} className={`rounded-md px-3 py-1 text-xs font-medium transition ${status === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{l}</button>
              ))}
            </div>
            <div className="ml-auto flex gap-1 rounded-lg bg-slate-200/60 p-1" role="tablist" aria-label="Channel">
              {([['', 'All channels', 'marketing'], ['email', 'Email', 'mail'], ['sms', 'SMS', 'sms']] as const).map(([v, l, icon]) => (
                <button key={v} role="tab" aria-selected={channel === v} onClick={() => setChannel(v)} className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition ${channel === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  <Icon name={icon} className="h-3.5 w-3.5" /> {l}
                </button>
              ))}
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Campaign</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="hidden px-4 py-3 md:table-cell">Delivered</th>
                  <th className="px-4 py-3">Opened</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Clicked</th>
                  <th className="hidden px-4 py-3 lg:table-cell">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((c) => {
                  const pct = c.stats.recipients ? Math.round((c.stats.sent / c.stats.recipients) * 100) : 0;
                  return (
                    <tr key={c.id} className="cursor-pointer hover:bg-slate-50/80" onClick={() => setEditing(c)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${c.channel === 'email' ? 'bg-sky-50 text-sky-600' : 'bg-emerald-50 text-emerald-600'}`}>
                            <Icon name={c.channel === 'email' ? 'mail' : 'sms'} className="h-[18px] w-[18px]" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate font-semibold text-slate-900">{c.name}</span>
                              {c.templateId && <span className="badge bg-violet-50 text-violet-700 ring-violet-600/15">designed</span>}
                              {c.abTest && <span className="badge bg-amber-50 text-amber-700 ring-amber-600/20">A/B{c.abWinner ? ` · ${c.abWinner} won` : ''}</span>}
                            </div>
                            <div className="truncate text-xs text-slate-500">{c.channel === 'email' ? c.subject || (c.templateId ? 'Template subject' : 'No subject') : c.body.slice(0, 70)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        {c.stats.recipients ? (
                          <div className="w-32">
                            <div className="flex justify-between text-xs"><span className="font-medium tabular-nums text-slate-800">{c.stats.sent.toLocaleString()} / {c.stats.recipients.toLocaleString()}</span>{c.stats.failed > 0 && <span className="text-rose-600">{c.stats.failed} failed</span>}</div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${c.status === 'sending' ? 'animate-pulse bg-sky-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></div>
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3"><Meter value={c.openRate} /></td>
                      <td className="hidden px-4 py-3 sm:table-cell"><Meter value={c.clickRate} tone="bg-violet-500" /></td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-[13px] text-slate-500 lg:table-cell">
                        {c.status === 'testing' && c.abDecideAt ? `Winner ${fmtDate(c.abDecideAt)}` : c.sentAt ? `Sent ${fmtDate(c.sentAt)}` : c.scheduledAt ? <span className="text-violet-700">Scheduled {fmtDate(c.scheduledAt)}</span> : `Created ${fmtDate(c.createdAt)}`}
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">No campaigns match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Modal open={editing !== null} title={editing === 'new' ? 'New campaign' : editing ? editing.name : ''} onClose={() => setEditing(null)} wide>
        {editing !== null && <CampaignEditor c={editing === 'new' ? null : editing} onDone={(m) => { setEditing(null); toast(m); load(); }} onChanged={load} />}
      </Modal>
    </>
  );
}

const DEFAULT_AB: AbTest = { subjectB: '', testPercent: 20, metric: 'opens', waitMinutes: 240 };
/** Mirrors the server's split (backend/src/campaigns/ab.ts splitForTest). */
function abSplitHint(count: number | null, pct: number) {
  if (count == null) return '';
  if (count < 4) return 'An A/B test needs at least 4 contacts in the audience.';
  const size = Math.min(count, Math.max(2, Math.round((count * pct) / 100)));
  const a = Math.ceil(size / 2);
  const b = size - a;
  const rest = count - size;
  return rest ? `${a} get A, ${b} get B, then the winner goes to the other ${rest}.` : `All ${count} split between A (${a}) and B (${b}); no winner send.`;
}
const WAIT_OPTIONS: Array<[number, string]> =[[15, '15 minutes'], [60, '1 hour'], [240, '4 hours'], [720, '12 hours'], [1440, '1 day'], [2880, '2 days']];

function CampaignEditor({ c, onDone, onChanged }: { c: Campaign | null; onDone: (m: string) => void; onChanged: () => void }) {
  const { can } = useAuth();
  const locked = !!c && !['draft', 'scheduled'].includes(c.status);
  const [f, setF] = useState({
    name: c?.name ?? '',
    channel: c?.channel ?? ('email' as 'email' | 'sms'),
    subject: c?.subject ?? '',
    body: c?.body ?? 'Hi {{contact.firstName}},\n\n',
    templateId: (c?.templateId ?? null) as string | null,
  });
  const [abOn, setAbOn] = useState(!!c?.abTest);
  const [ab, setAb] = useState<AbTest>(c?.abTest ?? DEFAULT_AB);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  useEffect(() => {
    api<TemplateRow[]>('/email-templates').then(setTemplates).catch(() => {});
  }, []);
  const designed = f.channel === 'email' && !!f.templateId;
  const tpl = templates.find((x) => x.id === f.templateId);
  const [statuses, setStatuses] = useState<string[]>(c?.audience.statuses ?? []);
  const [tags, setTags] = useState<string[]>(c?.audience.tags ?? []);
  const [listId, setListId] = useState<string>(c?.audience.listId ?? '');
  const [lists, setLists] = useState<Array<{ id: string; name: string; count: number; summary: string }>>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [when, setWhen] = useState<'now' | 'later'>(c?.scheduledAt ? 'later' : 'now');
  const [scheduledAt, setScheduledAt] = useState(c?.scheduledAt ? c.scheduledAt.slice(0, 16) : '');
  const [error, setError] = useState('');
  const aiEnabled = useAiEnabled();

  useEffect(() => {
    api<string[]>('/crm/contacts/tags').then(setAllTags).catch(() => {});
    api<typeof lists>('/crm/lists').then(setLists).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ count: number }>('/campaigns/audience-size', { method: 'POST', body: { ...(listId ? { listId } : {}), statuses, tags, channel: f.channel } }).then((r) => setCount(r.count)).catch(() => setCount(null));
    }, 250);
    return () => clearTimeout(t);
  }, [listId, statuses, tags, f.channel]);
  const activeList = lists.find((l) => l.id === listId);

  const toggle = (list: string[], v: string, set: (l: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save(send: boolean) {
    setError('');
    const useAb = abOn && f.channel === 'email';
    const body = { ...f, templateId: f.channel === 'email' ? f.templateId : null, audience: { ...(listId ? { listId } : {}), statuses, tags }, abTest: useAb ? ab : null };
    try {
      const saved = c ? await api<Campaign>(`/campaigns/${c.id}`, { method: 'PUT', body }) : await api<Campaign>('/campaigns', { method: 'POST', body });
      if (send) {
        const testSize = Math.min(count ?? 0, Math.max(2, Math.round(((count ?? 0) * ab.testPercent) / 100)));
        const msg = useAb
          ? `Start the A/B test now? ${testSize} of ${count ?? 0} contacts get variant A or B; the winner goes to the other ${(count ?? 0) - testSize} after ${WAIT_OPTIONS.find(([m]) => m === ab.waitMinutes)?.[1] ?? `${ab.waitMinutes} minutes`}.`
          : `Send "${f.name}" to ${count ?? 0} contacts now?`;
        if (when === 'now' && !confirm(msg)) return;
        await api(`/campaigns/${saved.id}/send`, { method: 'POST', body: when === 'later' && scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {} });
        onDone(when === 'later' ? 'Campaign scheduled' : useAb ? 'A/B test started' : 'Campaign is sending');
      } else onDone('Campaign saved');
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (locked && c) {
    return (
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={c.status} />
          <span className="text-slate-500">{c.channel === 'email' ? 'Email' : 'SMS'} campaign{c.sentAt ? ` · sent ${fmtDate(c.sentAt)}` : ''}</span>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([['recipients', 'Audience', 'contacts'], ['sent', 'Delivered', 'checkCheck'], ['failed', 'Failed', 'alert'], ['skipped', 'Skipped', 'close']] as const).map(([k, l, icon]) => (
            <div key={k} className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
              <dt className="flex items-center gap-1.5 text-xs text-slate-500"><Icon name={icon} className="h-3.5 w-3.5" /> {l}</dt>
              <dd className={`mt-1 text-xl font-semibold tabular-nums ${k === 'failed' && c.stats[k] ? 'text-rose-600' : ''}`}>{c.stats[k].toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        {c.channel === 'email' && c.abTest && <AbPanel c={c} onChanged={onChanged} />}
        {c.channel === 'email' && ['sent', 'testing'].includes(c.status) && <CampaignReport campaignId={c.id} />}
        {(c.subject && !c.abTest) || !c.templateId ? (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            {c.subject && !c.abTest && <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[13px]"><span className="text-slate-500">Subject: </span><span className="font-medium">{c.subject}</span></div>}
            {!c.templateId && <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap px-4 py-3 font-sans text-[13px] text-slate-700">{c.body}</pre>}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div><label className="label" htmlFor="cp-name">Campaign name *</label><input id="cp-name" required className="input" placeholder="e.g. November newsletter" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <fieldset>
        <legend className="label">Channel</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['email', 'sms'] as const).map((ch) => (
            <label key={ch} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition ${f.channel === ch ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300'}`}>
              <input type="radio" name="cp-ch" className="sr-only" checked={f.channel === ch} onChange={() => setF({ ...f, channel: ch })} />
              <span className={`grid h-9 w-9 place-items-center rounded-lg ${f.channel === ch ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Icon name={ch === 'email' ? 'mail' : 'sms'} className="h-[18px] w-[18px]" /></span>
              <span>
                <span className="block text-sm font-semibold">{ch === 'email' ? 'Email' : 'SMS'}</span>
                <span className="block text-xs text-slate-500">{ch === 'email' ? 'Plain or designed, with tracking' : 'Short text with opt-out'}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">Audience</legend>
        <div className="mb-3">
          <label className="label" htmlFor="cp-list">Contact list</label>
          <select id="cp-list" className="input" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">All contacts</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count.toLocaleString()})</option>)}
            {listId && !activeList && <option value={listId}>Deleted list — pick another</option>}
          </select>
          <p className="mt-1.5 text-xs text-slate-500">
            {activeList ? activeList.summary : 'Save a filtered view on the Contacts page to reuse it here.'}
            {(statuses.length > 0 || tags.length > 0) && ' The filters below narrow it further.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-slate-400">Status</span>
          {['lead', 'customer', 'churned'].map((s) => (
            <button type="button" key={s} aria-pressed={statuses.includes(s)} onClick={() => toggle(statuses, s, setStatuses)} className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition ${statuses.includes(s) ? 'border-brand-500 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
              {s}
            </button>
          ))}
          <span className="text-xs text-slate-400">none selected = {listId ? 'everyone in the list' : 'everyone'}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-slate-400">Has any tag</span>
          {allTags.length === 0 && <span className="text-xs text-slate-400">No tags yet</span>}
          {allTags.map((t) => (
            <button type="button" key={t} aria-pressed={tags.includes(t)} onClick={() => toggle(tags, t, setTags)} className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${tags.includes(t) ? 'border-brand-500 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>#{t}</button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5" aria-live="polite">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-brand-600 shadow-sm ring-1 ring-slate-200/80"><Icon name="contacts" className="h-4 w-4" /></span>
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{count === null ? '…' : count.toLocaleString()}</span> contact{count === 1 ? '' : 's'} will receive this
            <span className="block text-xs text-slate-500">Do-not-disturb contacts and those without {f.channel === 'email' ? 'an email' : 'a phone number'} are left out.</span>
          </p>
        </div>
      </fieldset>
      {f.channel === 'email' && (
        <div>
          <label className="label" htmlFor="cp-design">Design</label>
          <select id="cp-design" className="input" value={f.templateId ?? ''} onChange={(e) => setF({ ...f, templateId: e.target.value || null })}>
            <option value="">Plain text email</option>
            {templates.map((t) => <option key={t.id} value={t.id}>Template: {t.name}</option>)}
          </select>
          {designed && tpl && <p className="mt-1 text-xs text-slate-500">Uses “{tpl.name}”. <a className="text-brand-600 hover:underline" href={`/email-templates/${tpl.id}`} target="_blank" rel="noreferrer">Edit design ↗</a> · Each recipient gets their own merge fields and an unsubscribe link.</p>}
          {templates.length === 0 && <p className="mt-1 text-xs text-slate-500">Create designed emails under the “Email templates” tab.</p>}
        </div>
      )}
      {f.channel === 'email' && <div><label className="label" htmlFor="cp-subj">Subject{designed ? '' : ' *'}</label><input id="cp-subj" className="input" value={f.subject} placeholder={designed && tpl ? `Leave blank to use: ${tpl.subject}` : ''} onChange={(e) => setF({ ...f, subject: e.target.value })} /></div>}
      {f.channel === 'email' && (
        <fieldset className="rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold">A/B subject test</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={abOn} onChange={(e) => setAbOn(e.target.checked)} />
            Test a second subject line on part of the audience, then send the winner to everyone else
          </label>
          {abOn && !designed && <p className="mt-2 text-sm text-amber-700">Choose a designed template above. Plain-text emails aren’t tracked, so there would be nothing to judge the test on.</p>}
          {abOn && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="ab-b">Subject B *</label>
                <input id="ab-b" className="input" required value={ab.subjectB} maxLength={255} onChange={(e) => setAb({ ...ab, subjectB: e.target.value })} placeholder="e.g. Last chance: 20% off ends tonight" />
                <p className="mt-1 text-xs text-slate-500">Subject A is the subject above{designed && tpl && !f.subject.trim() ? ` (“${tpl.subject}”)` : ''}.</p>
              </div>
              <div>
                <label className="label" htmlFor="ab-pct">Test group: {ab.testPercent}% of audience</label>
                <input id="ab-pct" type="range" min={10} max={100} step={5} className="w-full" value={ab.testPercent} onChange={(e) => setAb({ ...ab, testPercent: Number(e.target.value) })} />
                <p className="text-xs text-slate-500">{abSplitHint(count, ab.testPercent)}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="ab-metric">Winner by</label>
                  <select id="ab-metric" className="input" value={ab.metric} onChange={(e) => setAb({ ...ab, metric: e.target.value as AbTest['metric'] })}><option value="opens">Open rate</option><option value="clicks">Click rate</option></select>
                </div>
                <div>
                  <label className="label" htmlFor="ab-wait">Decide after</label>
                  <select id="ab-wait" className="input" value={ab.waitMinutes} onChange={(e) => setAb({ ...ab, waitMinutes: Number(e.target.value) })}>{WAIT_OPTIONS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select>
                </div>
              </div>
            </div>
          )}
        </fieldset>
      )}
      {aiEnabled && !designed && (
        <AiButton
          label={`Write ${f.channel === 'email' ? 'email' : 'SMS'} from campaign name`}
          onClick={async () => {
            setError('');
            try {
              const d = await api<{ subject: string; body: string }>('/ai/draft', { method: 'POST', body: { channel: f.channel, goal: `Marketing campaign: ${f.name || 'promotion'}. Address the reader as {{contact.firstName}}.`, tone: 'persuasive' } });
              setF({ ...f, subject: d.subject || f.subject, body: d.body });
            } catch (e) {
              setError(errorText(e));
            }
          }}
        />
      )}
      {!designed && <div>
        <label className="label" htmlFor="cp-body">Message *</label>
        <textarea id="cp-body" rows={8} className="input" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <p className="mt-1 text-xs text-slate-500">Personalise with <code>{'{{contact.firstName}}'}</code>. {f.channel === 'email' ? 'An unsubscribe link is added automatically.' : '“Reply STOP to opt out.” is appended.'}{f.channel === 'sms' && ` ${f.body.length} characters.`}</p>
      </div>}
      <fieldset>
        <legend className="label">When to send</legend>
        <div className="flex flex-wrap items-center gap-2">
          {([['now', 'Send now', 'send'], ['later', 'Schedule', 'calendar']] as const).map(([v, l, icon]) => (
            <label key={v} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${when === v ? 'border-brand-500 bg-brand-50/60 text-brand-800 ring-1 ring-brand-500' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
              <input type="radio" name="cp-when" className="sr-only" checked={when === v} onChange={() => setWhen(v)} />
              <Icon name={icon} className="h-4 w-4" /> {l}
            </label>
          ))}
          {when === 'later' && <input aria-label="Send at" type="datetime-local" className="input h-10 w-auto" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />}
        </div>
      </fieldset>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-between gap-2 border-t border-slate-100 pt-4">
        {c ? <button type="button" className="btn-ghost text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={async () => { if (!confirm('Delete this campaign?')) return; await api(`/campaigns/${c.id}`, { method: 'DELETE' }); onDone('Campaign deleted'); }}>Delete</button> : <span />}
        <div className="flex gap-2">
          <button className="btn-secondary">Save draft</button>
          {can('campaigns:send') && <button type="button" className="btn-primary" disabled={when === 'later' && !scheduledAt} onClick={() => save(true)}><Icon name={when === 'later' ? 'calendar' : 'send'} className="h-4 w-4" /> {when === 'later' ? 'Schedule' : 'Send now'}</button>}
        </div>
      </div>
    </form>
  );
}
