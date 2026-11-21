'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, download, parseCsv } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Contact, Paged } from '@/lib/types';
import { ContactForm } from '@/components/contact-form';
import { EmptyState, Modal, PageHeader, Spinner, StatusBadge, Tag, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ContactAvatar } from '@/components/contact-avatar';

const STATUS_TABS = [['', 'All'], ['lead', 'Leads'], ['customer', 'Customers'], ['churned', 'Churned']] as const;
const DAY_OPTIONS = [['', 'Added: any time'], ['7', 'Added: last 7 days'], ['30', 'Added: last 30 days'], ['90', 'Added: last 90 days']] as const;

interface Filters { search?: string; statuses?: string[]; tags?: string[]; source?: string; createdWithinDays?: number }
interface SmartList { id: string; name: string; filters: Filters; summary: string; count: number }

/** Lists saved from this page hold at most one status and one tag, so they map onto the controls. */
const fitsControls = (f: Filters) => (f.statuses?.length ?? 0) <= 1 && (f.tags?.length ?? 0) <= 1;

export default function ContactsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Contacts />
    </Suspense>
  );
}

function Contacts() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [tag, setTag] = useState(params.get('tag') ?? '');
  const [source, setSource] = useState(params.get('source') ?? '');
  const [days, setDays] = useState(params.get('days') ?? '');
  const [listId, setListId] = useState(params.get('list') ?? '');
  const [lists, setLists] = useState<SmartList[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [saving, setSaving] = useState<'new' | 'rename' | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Contact> | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [editing, setEditing] = useState<Contact | null | 'new'>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const activeList = lists.find((l) => l.id === listId) ?? null;
  // Lists made through the API can hold several statuses/tags; those are applied server-side by id.
  const serverList = activeList && !fitsControls(activeList.filters) ? activeList : null;
  const current: Filters = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(status ? { statuses: [status] } : {}),
    ...(tag ? { tags: [tag] } : {}),
    ...(source ? { source } : {}),
    ...(days ? { createdWithinDays: Number(days) } : {}),
  };
  const hasFilters = Object.keys(current).length > 0;
  const sameAsList = !!activeList && JSON.stringify(normalise(activeList.filters)) === JSON.stringify(normalise(current));

  const loadLists = useCallback(() => api<SmartList[]>('/crm/lists').then(setLists).catch(() => {}), []);
  useEffect(() => {
    loadLists();
    api<string[]>('/crm/contacts/sources').then(setSources).catch(() => {});
  }, [loadLists]);

  function openList(l: SmartList | null) {
    setListId(l?.id ?? '');
    setPage(1);
    const f = l && fitsControls(l.filters) ? l.filters : {};
    setSearch(f.search ?? '');
    setStatus(f.statuses?.[0] ?? '');
    setTag(f.tags?.[0] ?? '');
    setSource(f.source ?? '');
    setDays(f.createdWithinDays ? String(f.createdWithinDays) : '');
  }

  async function saveList(mode: 'new' | 'update' | 'rename', name?: string) {
    try {
      if (mode === 'new') {
        const l = await api<SmartList>('/crm/lists', { method: 'POST', body: { name, filters: current } });
        setListId(l.id);
        toast(`Saved “${l.name}”`);
      } else if (activeList) {
        await api(`/crm/lists/${activeList.id}`, { method: 'PUT', body: mode === 'rename' ? { name } : { filters: current } });
        toast(mode === 'rename' ? 'List renamed' : `Updated “${activeList.name}”`);
      }
      setSaving(null);
      loadLists();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  async function deleteList(l: SmartList) {
    if (!confirm(`Delete the list “${l.name}”? Contacts aren’t affected. Campaigns that target this list will need a new audience.`)) return;
    try {
      await api(`/crm/lists/${l.id}`, { method: 'DELETE' });
      toast('List deleted');
      openList(null);
      loadLists();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  const load = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) q.set('search', search.trim());
    if (status) q.set('status', status);
    if (tag) q.set('tag', tag);
    if (source) q.set('source', source);
    if (days) q.set('createdWithinDays', days);
    if (serverList) q.set('listId', serverList.id);
    try {
      setData(await api<Paged<Contact>>(`/crm/contacts?${q}`));
      setSelected(new Set());
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }, [page, search, status, tag, source, days, serverList, toast]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api<string[]>('/crm/contacts/tags').then(setAllTags).catch(() => {});
  }, [data]);

  useEffect(() => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (status) q.set('status', status);
    if (tag) q.set('tag', tag);
    if (source) q.set('source', source);
    if (days) q.set('days', days);
    if (listId) q.set('list', listId);
    router.replace(`/contacts${q.size ? `?${q}` : ''}`, { scroll: false });
  }, [search, status, tag, source, days, listId, router]);

  async function bulk(action: string, value?: string | boolean) {
    if (action === 'delete' && !confirm(`Delete ${selected.size} contacts?`)) return;
    try {
      const r = await api('/crm/contacts/bulk', { method: 'POST', body: { ids: [...selected], action, value } });
      toast(`Updated ${r.affected} contacts`);
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  async function importFile(file: File) {
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length) throw new Error('The file has no data rows');
      const r = await api('/crm/contacts/import', { method: 'POST', body: { rows } });
      toast(`Imported: ${r.created} new, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} skipped` : ''}`, r.errors.length ? 'error' : 'ok');
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(c: Contact) {
    if (!confirm(`Delete ${c.firstName} ${c.lastName}?`)) return;
    try {
      await api(`/crm/contacts/${c.id}`, { method: 'DELETE' });
      toast('Contact deleted');
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle={data ? `${data.total} contact${data.total === 1 ? '' : 's'}` : undefined}
        actions={
          <>
            {can('contacts:import') && (
              <>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
                <button className="btn-secondary" onClick={() => fileRef.current?.click()} title="CSV with columns like first_name, last_name, email, phone, company, tags"><Icon name="forms" className="h-4 w-4" /> Import</button>
              </>
            )}
            {can('contacts:export') && <button className="btn-secondary" onClick={() => download('/crm/contacts/export', 'contacts.csv').catch((e) => toast(errorText(e), 'error'))}><Icon name="arrowUpRight" className="h-4 w-4" /> Export</button>}
            {can('contacts:write') && <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" /> New contact</button>}
          </>
        }
      />

      {lists.length > 0 && (
        <nav className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Saved lists">
          <button onClick={() => openList(null)} aria-current={!listId ? 'page' : undefined} className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${!listId ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'}`}>
            <Icon name="contacts" className="h-3.5 w-3.5" /> All contacts
          </button>
          {lists.map((l) => {
            const on = l.id === listId;
            return (
              <button key={l.id} onClick={() => openList(l)} aria-current={on ? 'page' : undefined} title={l.summary} className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${on ? 'border-brand-600 bg-brand-600 text-white shadow-sm shadow-brand-600/25' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-slate-900'}`}>
                <Icon name="layers" className="h-3.5 w-3.5" />
                {l.name}
                <span className={`rounded-full px-1.5 text-[10px] font-semibold leading-4 tabular-nums ${on ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{l.count.toLocaleString()}</span>
              </button>
            );
          })}
        </nav>
      )}

      {activeList && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-brand-200/70 bg-brand-50/60 px-4 py-2.5 text-sm">
          <Icon name="layers" className="h-4 w-4 text-brand-600" />
          <span className="font-semibold text-slate-900">{activeList.name}</span>
          <span className="text-slate-500">{activeList.summary}</span>
          {can('contacts:write') && (
            <span className="ml-auto flex items-center gap-1">
              <button className="btn-ghost h-7 px-2 text-xs" onClick={() => setSaving('rename')}><Icon name="pencil" className="h-3.5 w-3.5" /> Rename</button>
              <button className="btn-ghost h-7 px-2 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-600" onClick={() => deleteList(activeList)}><Icon name="trash" className="h-3.5 w-3.5" /> Delete</button>
            </span>
          )}
        </div>
      )}

      <Modal open={!!saving} title={saving === 'rename' ? 'Rename list' : 'Save as list'} onClose={() => setSaving(null)}>
        {saving && (
          <ListNameForm
            initial={saving === 'rename' ? activeList?.name ?? '' : ''}
            summary={saving === 'rename' ? activeList?.summary : describe(current)}
            cta={saving === 'rename' ? 'Rename' : 'Save list'}
            onSubmit={(name) => saveList(saving === 'rename' ? 'rename' : 'new', name)}
          />
        )}
      </Modal>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-slate-200/60 p-1" role="tablist" aria-label="Filter by status">
          {STATUS_TABS.map(([v, l]) => (
            <button key={v} role="tab" aria-selected={status === v} onClick={() => { setStatus(v); setPage(1); }} className={`rounded-md px-3 py-1 text-xs font-medium transition ${status === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            aria-label="Search contacts"
            placeholder="Search name, email or company…"
            className="input h-9 pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select aria-label="Filter by tag" className="input h-9 w-auto py-0" value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); }}>
          <option value="">All tags</option>
          {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
        </select>
        <select aria-label="Filter by source" className="input h-9 w-auto py-0" value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}>
          <option value="">All sources</option>
          {sources.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
        </select>
        <select aria-label="Filter by date added" className="input h-9 w-auto py-0" value={days} onChange={(e) => { setDays(e.target.value); setPage(1); }}>
          {DAY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-1.5">
          {hasFilters && !activeList && <button className="btn-ghost h-9 text-xs" onClick={() => openList(null)}>Clear</button>}
          {can('contacts:write') && hasFilters && !sameAsList && !serverList && (
            <>
              {activeList && <button className="btn-secondary h-9 text-[13px]" onClick={() => saveList('update')}>Save changes</button>}
              <button className={`${activeList ? 'btn-ghost' : 'btn-secondary'} h-9 text-[13px]`} onClick={() => setSaving('new')}>
                <Icon name="layers" className="h-4 w-4" /> {activeList ? 'Save as new list' : 'Save as list'}
              </button>
            </>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-pop-in flex-wrap items-center gap-1 rounded-2xl bg-slate-900 px-2 py-1.5 text-sm text-white shadow-pop ring-1 ring-white/10" role="region" aria-label="Bulk actions">
          <span className="flex items-center gap-2 px-2.5 font-medium">
            <span className="grid h-6 min-w-6 place-items-center rounded-full bg-brand-500 px-1.5 text-xs font-semibold tabular-nums">{selected.size}</span>
            selected
          </span>
          <span className="mx-1 h-5 w-px bg-white/15" />
          <button className="rounded-lg px-2.5 py-1.5 hover:bg-white/10" onClick={() => { const t = prompt('Tag to add'); if (t) bulk('add_tag', t); }}>Add tag</button>
          <button className="rounded-lg px-2.5 py-1.5 hover:bg-white/10" onClick={() => { const t = prompt('Tag to remove'); if (t) bulk('remove_tag', t); }}>Remove tag</button>
          <select aria-label="Set status" className="cursor-pointer rounded-lg bg-transparent px-2 py-1.5 hover:bg-white/10 focus:outline-none [&>option]:text-slate-900" value="" onChange={(e) => e.target.value && bulk('set_status', e.target.value)}>
            <option value="">Set status…</option><option value="lead">Lead</option><option value="customer">Customer</option><option value="churned">Churned</option>
          </select>
          <button className="rounded-lg px-2.5 py-1.5 hover:bg-white/10" onClick={() => bulk('set_dnd', true)}>Do not disturb</button>
          {can('contacts:delete') && <button className="rounded-lg px-2.5 py-1.5 text-rose-300 hover:bg-rose-500/20" onClick={() => bulk('delete')}>Delete</button>}
          <button className="grid h-8 w-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" aria-label="Clear selection" onClick={() => setSelected(new Set())}><Icon name="close" className="h-4 w-4" /></button>
        </div>
      )}

      {!data ? (
        <div className="grid h-48 place-items-center"><Spinner /></div>
      ) : data.items.length === 0 ? (
        <EmptyState title="No contacts found">
          {hasFilters || listId ? 'No contacts match these filters right now.' : 'Create your first contact to get started.'}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={data.items.length > 0 && data.items.every((c) => selected.has(c.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(data.items.map((c) => c.id)) : new Set())}
                  />
                </th>
                <th className="px-4 py-3">Contact</th>
                <th className="hidden px-4 py-3 md:table-cell">Phone</th>
                <th className="hidden px-4 py-3 lg:table-cell">Company</th>
                <th className="px-4 py-3">Status</th>
                <th className="hidden px-4 py-3 md:table-cell">Tags</th>
                <th className="hidden px-4 py-3 xl:table-cell">Added</th>
                <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((c) => (
                <tr
                  key={c.id}
                  className={`group cursor-pointer ${selected.has(c.id) ? 'bg-brand-50/70' : 'hover:bg-slate-50/80'}`}
                  onClick={(e) => {
                    // Row opens the contact, except when using a control inside it.
                    if ((e.target as HTMLElement).closest('a,button,input,label')) return;
                    router.push(`/contacts/${c.id}`);
                  }}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${c.firstName} ${c.lastName}`}
                      checked={selected.has(c.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <ContactAvatar c={c} />
                      <div className="min-w-0">
                        <Link href={`/contacts/${c.id}`} className="block truncate font-semibold text-slate-900 hover:text-brand-700">
                          {`${c.firstName} ${c.lastName}`.trim() || 'Unnamed contact'}
                        </Link>
                        <div className="truncate text-xs text-slate-500">{c.email ?? 'No email'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-2.5 text-slate-600 md:table-cell">{c.phone ?? <span className="text-slate-300">—</span>}</td>
                  <td className="hidden px-4 py-2.5 text-slate-600 lg:table-cell">{c.company?.name ?? <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={c.status} /></td>
                  <td className="hidden px-4 py-2.5 md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.slice(0, 2).map((t) => <Tag key={t}>{t}</Tag>)}
                      {c.tags.length > 2 && <span className="badge bg-slate-100 text-slate-600 ring-slate-500/10" title={c.tags.slice(2).join(', ')}>+{c.tags.length - 2}</span>}
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-2.5 text-xs text-slate-500 xl:table-cell">{new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <span className="inline-flex gap-1 opacity-60 transition group-hover:opacity-100 focus-within:opacity-100">
                      {can('contacts:write') && (
                        <button className="btn-ghost h-8 w-8 px-0" title="Edit" aria-label={`Edit ${c.firstName} ${c.lastName}`} onClick={() => setEditing(c)}>
                          <Icon name="pencil" className="h-4 w-4" />
                        </button>
                      )}
                      {can('contacts:delete') && (
                        <button className="btn-ghost h-8 w-8 px-0 hover:bg-rose-50 hover:text-rose-600" title="Delete" aria-label={`Delete ${c.firstName} ${c.lastName}`} onClick={() => remove(c)}>
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-[13px]">
            <span className="text-slate-500">
              Showing <span className="font-medium text-slate-700">{(data.page - 1) * data.limit + 1}–{(data.page - 1) * data.limit + data.items.length}</span> of <span className="font-medium text-slate-700">{data.total}</span>
            </span>
            {data.pages > 1 && (
              <div className="flex items-center gap-2">
                <button className="btn-secondary h-8 px-2.5" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><Icon name="arrowLeft" className="h-4 w-4" /></button>
                <span className="tabular-nums text-slate-500">{data.page} / {data.pages}</span>
                <button className="btn-secondary h-8 px-2.5" disabled={page >= data.pages} onClick={() => setPage(page + 1)} aria-label="Next page"><Icon name="chevronRight" className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        </div>
      )}

      <Modal open={editing !== null} title={editing === 'new' ? 'New contact' : 'Edit contact'} onClose={() => setEditing(null)} wide>
        {editing !== null && (
          <ContactForm
            contact={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              toast(editing === 'new' ? 'Contact created' : 'Contact updated');
              setEditing(null);
              load();
            }}
          />
        )}
      </Modal>
    </>
  );
}

const normalise = (f: Filters) => ({
  search: f.search?.trim() || '',
  statuses: [...(f.statuses ?? [])].sort(),
  tags: [...(f.tags ?? [])].sort(),
  source: f.source || '',
  days: f.createdWithinDays || 0,
});

/** Same wording as the API's describeFilters, for a list that isn't saved yet. */
function describe(f: Filters) {
  const parts: string[] = [];
  if (f.statuses?.length) parts.push(f.statuses.map((s) => `${s[0].toUpperCase()}${s.slice(1)}s`).join(' or '));
  if (f.tags?.length) parts.push(`tagged ${f.tags.join(' or ')}`);
  if (f.source) parts.push(`from ${f.source.replace(/_/g, ' ')}`);
  if (f.createdWithinDays) parts.push(`added in the last ${f.createdWithinDays} days`);
  if (f.search) parts.push(`matching “${f.search}”`);
  return parts.join(' · ') || 'All contacts';
}

function ListNameForm({ initial, summary, cta, onSubmit }: { initial: string; summary?: string; cta: string; onSubmit: (name: string) => Promise<void> | void }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSubmit(name.trim());
        setBusy(false);
      }}
    >
      <div>
        <label className="label" htmlFor="sl-name">List name</label>
        <input id="sl-name" required maxLength={80} className="input" placeholder="e.g. Hot leads this month" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {summary && (
        <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600 ring-1 ring-inset ring-slate-200/70">
          <Icon name="layers" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <span>
            <span className="font-medium text-slate-800">{summary}</span>
            <span className="block text-xs text-slate-500">The list updates itself as contacts change. Use it here or as a campaign audience.</span>
          </span>
        </p>
      )}
      <div className="flex justify-end border-t border-slate-100 pt-4">
        <button className="btn-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : cta}</button>
      </div>
    </form>
  );
}
