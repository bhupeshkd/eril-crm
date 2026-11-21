'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Contact, Paged } from '@/lib/types';
import { ChannelList, CommunityFeed, Leaderboard, type Channel } from '@/components/community-feed';
import { EditorBar, EmptyState, Modal, PageLoader, Tabs, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ContactAvatar } from '@/components/contact-avatar';

interface Detail {
  id: string;
  name: string;
  description: string;
  joinMode: 'invite' | 'open';
  autoJoinCourseIds: string[];
  tags: string[];
  isActive: boolean;
  channels: Channel[];
  joinUrl: string | null;
  digestFrequency: 'off' | 'daily' | 'weekly';
  digestHour: number;
  digestWeekday: number;
  timezone: string;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIMEZONES = (() => {
  try {
    return (Intl as any).supportedValuesOf('timeZone') as string[];
  } catch {
    return ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata'];
  }
})();
const hourLabel = (h: number) => new Date(Date.UTC(2020, 0, 1, h)).toLocaleTimeString(undefined, { hour: 'numeric', timeZone: 'UTC' });
interface MemberRow {
  id: string;
  displayName: string;
  role: 'member' | 'moderator';
  status: 'active' | 'banned';
  source: string;
  lastSeenAt: string | null;
  createdAt: string;
  posts: number;
  portalUrl: string | null;
  digest: 'community' | 'off' | 'daily' | 'weekly';
  contact: { id: string; firstName: string; lastName: string; email: string | null };
}

type Tab = 'feed' | 'members' | 'settings';

export default function CommunityPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { can } = useAuth();
  const [c, setC] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>('feed');
  const [channelId, setChannelId] = useState<string | null>(null);

  const load = useCallback(() => api<Detail>(`/communities/${id}`).then(setC).catch((e) => toast(errorText(e), 'error')), [id, toast]);
  useEffect(() => {
    load();
    const t = new URLSearchParams(location.search).get('tab');
    if (t === 'members' || t === 'settings') setTab(t);
  }, [load]);

  const client = useMemo(() => ({ base: `/communities/${id}`, auth: true, moderator: can('courses:write'), canPostStaffOnly: can('courses:write') }), [id, can]);
  if (!c) return <PageLoader />;

  return (
    <>
      <EditorBar
        back={{ href: '/communities', label: 'Community' }}
        title={
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-[13px] font-semibold text-white">{c.name.trim().charAt(0).toUpperCase()}</span>
            <h1 className="truncate text-lg font-semibold tracking-tight">{c.name}</h1>
          </div>
        }
        status={
          <span className={`badge ${!c.isActive ? 'bg-slate-100 text-slate-600' : c.joinMode === 'open' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-violet-50 text-violet-700 ring-violet-600/15'}`}>
            <Icon name={c.isActive && c.joinMode === 'open' ? 'sites' : 'lock'} className="h-3 w-3" />
            {!c.isActive ? 'Closed' : c.joinMode === 'open' ? 'Open' : 'Invite only'}
          </span>
        }
        actions={c.joinUrl && c.joinMode === 'open' && (
          <button className="btn-secondary" onClick={() => { navigator.clipboard.writeText(c.joinUrl!); toast('Join link copied'); }}><Icon name="copy" /> Copy join link</button>
        )}
      />
      <Tabs<Tab> value={tab} onChange={setTab} options={[['feed', 'Feed'], ['members', 'Members'], ['settings', 'Settings']]} />
      {tab === 'feed' && (
        <div className="grid gap-6 md:grid-cols-[240px_1fr]">
          <div className="space-y-4">
            <ChannelList channels={c.channels} value={channelId} onChange={setChannelId} />
            <Leaderboard client={client} />
          </div>
          <div className="min-w-0">
            <p className="mb-3 flex items-center gap-1.5 text-xs text-slate-500"><Icon name="alert" className="h-3.5 w-3.5" />You post as the team. Hidden posts stay visible to staff only.</p>
            <CommunityFeed client={client} channels={c.channels} channelId={channelId} contactHref={(cid) => `/contacts/${cid}`} />
          </div>
        </div>
      )}
      {tab === 'members' && <Members communityId={c.id} />}
      {tab === 'settings' && <Settings c={c} onSaved={load} />}
    </>
  );
}

function Members({ communityId }: { communityId: string }) {
  const toast = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => api<MemberRow[]>(`/communities/${communityId}/members`).then(setRows).catch((e) => toast(errorText(e), 'error')), [communityId, toast]);
  useEffect(() => {
    load();
  }, [load]);
  const update = async (m: MemberRow, body: Partial<MemberRow>, msg: string) => {
    try {
      await api(`/communities/${communityId}/members/${m.id}`, { method: 'PUT', body });
      toast(msg);
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const editable = can('courses:write');
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-slate-500">Members open the community with a personal link (emailed when they’re added). Other members only see their display name.</p>
        {editable && <button className="btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> Add member</button>}
      </div>
      {!rows ? <PageLoader /> : rows.length === 0 ? <EmptyState title="No members yet">Add contacts here, or link a course in Settings so students join automatically.</EmptyState> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200">
              <tr><th className="px-4 py-2.5">Member</th><th className="px-4 py-2.5">Shown as</th><th className="px-4 py-2.5">Role</th><th className="px-4 py-2.5">Posts</th><th className="px-4 py-2.5">Last seen</th><th className="px-4 py-2.5">Joined via</th><th className="px-4 py-2.5">Digest</th><th className="px-4 py-2.5"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((m) => (
                <tr key={m.id} className={m.status === 'banned' ? 'bg-rose-50/40' : 'hover:bg-slate-50/70'}>
                  <td className="px-4 py-2.5">
                    <Link href={`/contacts/${m.contact.id}`} className="flex items-center gap-2.5">
                      <ContactAvatar c={m.contact} size="h-8 w-8 text-[11px]" />
                      <span className="min-w-0"><span className="block font-medium hover:text-brand-600">{m.contact.firstName} {m.contact.lastName}</span><span className="block truncate text-xs text-slate-500">{m.contact.email}</span></span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{m.displayName}</td>
                  <td className="px-4 py-2.5">
                    {editable ? (
                      <select aria-label={`Role for ${m.displayName}`} className="input h-8 w-auto py-0 pl-2 text-xs" value={m.role} onChange={(e) => update(m, { role: e.target.value as MemberRow['role'] }, 'Role updated')}>
                        <option value="member">Member</option><option value="moderator">Moderator</option>
                      </select>
                    ) : m.role}
                    {m.status === 'banned' && <span className="badge ml-1 bg-rose-50 text-rose-700 ring-rose-600/15">Banned</span>}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{m.posts}</td>
                  <td className="px-4 py-2.5 text-slate-500">{m.lastSeenAt ? fmtDate(m.lastSeenAt) : <span className="text-slate-400">Never</span>}</td>
                  <td className="px-4 py-2.5 capitalize text-slate-500">{m.source.replace('_', ' ')}</td>
                  <td className="px-4 py-2.5 capitalize text-slate-500">{m.digest === 'community' ? 'Default' : m.digest}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {m.portalUrl && <button className="btn-ghost h-7 px-2 text-xs" title="Copy personal link" onClick={() => { navigator.clipboard.writeText(m.portalUrl!); toast('Personal link copied — only share it with this member'); }}><Icon name="copy" className="h-3.5 w-3.5" /> Link</button>}
                    {editable && (
                      <>
                        <button className="btn-ghost h-7 px-2 text-xs" onClick={async () => { if (!confirm('Issue a new link? The old one stops working.')) return; await api(`/communities/${communityId}/members/${m.id}/reset-link`, { method: 'POST' }); toast('New link issued'); load(); }}>Reset link</button>
                        <button className="btn-ghost h-7 px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => update(m, { status: m.status === 'banned' ? 'active' : 'banned' }, m.status === 'banned' ? 'Member restored' : 'Member banned')}>{m.status === 'banned' ? 'Unban' : 'Ban'}</button>
                        <button className="btn-ghost h-7 w-7 px-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${m.displayName}`} title="Remove member" onClick={async () => { if (!confirm(`Remove ${m.displayName}? Their posts stay.`)) return; await api(`/communities/${communityId}/members/${m.id}`, { method: 'DELETE' }); load(); }}><Icon name="trash" className="h-3.5 w-3.5" /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={adding} title="Add member" onClose={() => setAdding(false)}>
        {adding && <AddMember communityId={communityId} onDone={() => { setAdding(false); toast('Member added'); load(); }} />}
      </Modal>
    </>
  );
}

function AddMember({ communityId, onDone }: { communityId: string; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState('');
  const [notify, setNotify] = useState(true);
  const [role, setRole] = useState<'member' | 'moderator'>('member');
  const [error, setError] = useState('');
  useEffect(() => {
    const t = setTimeout(() => api<Paged<Contact>>(`/crm/contacts?limit=50${q ? `&search=${encodeURIComponent(q)}` : ''}`).then((r) => setContacts(r.items)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        try {
          await api(`/communities/${communityId}/members`, { method: 'POST', body: { contactId, notify, role } });
          onDone();
        } catch (err) {
          setError(errorText(err));
        }
      }}
    >
      <div><label className="label" htmlFor="am-q">Search contacts</label><input id="am-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" /></div>
      <div>
        <label className="label" htmlFor="am-c">Contact</label>
        <select id="am-c" required className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">Choose…</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}{c.email ? ` — ${c.email}` : ''}</option>)}
        </select>
      </div>
      <div><label className="label" htmlFor="am-r">Role</label><select id="am-r" className="input" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'moderator')}><option value="member">Member</option><option value="moderator">Moderator (can hide and pin posts)</option></select></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email them their personal link</label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end"><button className="btn-primary" disabled={!contactId}>Add</button></div>
    </form>
  );
}

/** Shows the digest a chosen member would get next (their personal link is masked). */
function DigestPreview({ communityId }: { communityId: string }) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberId, setMemberId] = useState('');
  const [preview, setPreview] = useState<{ empty: boolean; subject?: string; html?: string; totalPosts?: number } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<MemberRow[]>(`/communities/${communityId}/members`).then((m) => setMembers(m.filter((x) => x.status === 'active'))).catch(() => {});
  }, [communityId]);
  if (!members.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <div className="flex-1">
        <label className="label" htmlFor="dp-m">Preview the next digest for</label>
        <select id="dp-m" className="input" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">Choose a member…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.displayName} ({m.contact.firstName} {m.contact.lastName})</option>)}
        </select>
      </div>
      <button
        type="button"
        className="btn-secondary"
        disabled={!memberId}
        onClick={async () => {
          setError('');
          try {
            setPreview(await api(`/communities/${communityId}/digests/preview?memberId=${memberId}`));
          } catch (e) {
            setError(errorText(e));
          }
        }}
      >
        Preview
      </button>
      {error && <p role="alert" className="w-full text-sm text-rose-600">{error}</p>}
      <Modal open={!!preview} title={preview?.subject ?? 'Digest preview'} onClose={() => setPreview(null)} wide>
        {preview?.empty ? (
          <p className="text-sm text-slate-500">Nothing new for this member right now, so no digest would be sent.</p>
        ) : preview?.html ? (
          <iframe title="Digest preview" sandbox="" className="h-[70vh] w-full rounded border border-slate-200" srcDoc={preview.html} />
        ) : null}
      </Modal>
    </div>
  );
}

function Settings({ c, onSaved }: { c: Detail; onSaved: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { can } = useAuth();
  const [f, setF] = useState({
    name: c.name,
    description: c.description,
    joinMode: c.joinMode,
    isActive: c.isActive,
    tags: c.tags.join(', '),
    autoJoinCourseIds: c.autoJoinCourseIds,
    digestFrequency: c.digestFrequency,
    digestHour: c.digestHour,
    digestWeekday: c.digestWeekday,
    timezone: c.timezone,
  });
  const [courses, setCourses] = useState<Array<{ id: string; title: string }>>([]);
  const [newChannel, setNewChannel] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api<Array<{ id: string; title: string }>>('/courses').then(setCourses).catch(() => {});
  }, []);
  if (!can('courses:write')) return <p className="text-sm text-slate-500">You need course editing rights to change community settings.</p>;
  const ch = (path: string, method: string, body?: any) => api(`/communities/${c.id}/channels${path}`, { method, body }).then(onSaved).catch((e) => toast(errorText(e), 'error'));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="card space-y-4 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            await api(`/communities/${c.id}`, { method: 'PUT', body: { ...f, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean) } });
            toast('Settings saved');
            onSaved();
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <h2 className="-mx-5 -mt-5 border-b border-slate-100 px-5 py-3.5 font-semibold">General</h2>
        <div><label className="label" htmlFor="cs-name">Name</label><input id="cs-name" required className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="cs-desc">Description</label><textarea id="cs-desc" rows={2} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <fieldset className="space-y-1 text-sm">
          <legend className="label">Who can join</legend>
          <label className="flex items-center gap-2"><input type="radio" checked={f.joinMode === 'invite'} onChange={() => setF({ ...f, joinMode: 'invite' })} /> Invite only (you add members, or via courses below)</label>
          <label className="flex items-center gap-2"><input type="radio" checked={f.joinMode === 'open'} onChange={() => setF({ ...f, joinMode: 'open' })} /> Open: anyone can request access from a join page (link sent by email)</label>
        </fieldset>
        {c.joinUrl && f.joinMode === 'open' && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-xs">
            <code className="flex-1 truncate text-slate-600">{c.joinUrl}</code>
            <button type="button" className="btn-ghost h-7 px-2 text-xs" onClick={() => { navigator.clipboard.writeText(c.joinUrl!); toast('Join link copied'); }}><Icon name="copy" className="h-3.5 w-3.5" /> Copy</button>
          </div>
        )}
        <fieldset>
          <legend className="label">Add students automatically when they enroll in</legend>
          {courses.length === 0 ? <p className="text-sm text-slate-500">No courses yet.</p> : courses.map((co) => (
            <label key={co.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.autoJoinCourseIds.includes(co.id)} onChange={(e) => setF({ ...f, autoJoinCourseIds: e.target.checked ? [...f.autoJoinCourseIds, co.id] : f.autoJoinCourseIds.filter((x) => x !== co.id) })} />
              {co.title}
            </label>
          ))}
        </fieldset>
        <div><label className="label" htmlFor="cs-tags">Tag new members</label><input id="cs-tags" className="input" placeholder="e.g. community" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></div>
        <fieldset className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <legend className="flex items-center gap-1.5 px-1 text-sm font-medium"><Icon name="mail" className="h-4 w-4 text-slate-400" />Email digest</legend>
          <p className="mb-2 text-xs text-slate-500">A summary of new posts each member hasn’t seen yet (nothing is sent when there’s nothing new). Members can change or stop it from their community page.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cs-df">Send</label>
              <select id="cs-df" className="input" value={f.digestFrequency} onChange={(e) => setF({ ...f, digestFrequency: e.target.value as Detail['digestFrequency'] })}>
                <option value="weekly">Weekly</option><option value="daily">Daily</option><option value="off">Off (no digests)</option>
              </select>
            </div>
            {f.digestFrequency === 'weekly' && (
              <div>
                <label className="label" htmlFor="cs-dw">On</label>
                <select id="cs-dw" className="input" value={f.digestWeekday} onChange={(e) => setF({ ...f, digestWeekday: Number(e.target.value) })}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
              </div>
            )}
            {f.digestFrequency !== 'off' && (
              <>
                <div>
                  <label className="label" htmlFor="cs-dh">Around</label>
                  <select id="cs-dh" className="input" value={f.digestHour} onChange={(e) => setF({ ...f, digestHour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
                </div>
                <div>
                  <label className="label" htmlFor="cs-tz">Timezone</label>
                  <select id="cs-tz" className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</select>
                </div>
              </>
            )}
          </div>
          <DigestPreview communityId={c.id} />
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Community is open (unticked: member links stop working)</label>
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-between border-t border-slate-100 pt-4">
          <button type="button" className="btn-danger" onClick={async () => { if (!confirm(`Delete "${c.name}"? Members lose access.`)) return; await api(`/communities/${c.id}`, { method: 'DELETE' }); router.push('/communities'); }}><Icon name="trash" /> Delete community</button>
          <button className="btn-primary">Save settings</button>
        </div>
      </form>
      <section className="card self-start space-y-3 p-5">
        <h2 className="-mx-5 -mt-5 border-b border-slate-100 px-5 py-3.5 font-semibold">Channels</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {c.channels.map((x, i) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="text-slate-400">#</span>
              <input aria-label="Channel name" className="input h-8 w-40 py-1" defaultValue={x.name} onBlur={(e) => e.target.value.trim() && e.target.value !== x.name && ch(`/${x.id}`, 'PUT', { name: e.target.value })} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={x.staffOnly} onChange={(e) => ch(`/${x.id}`, 'PUT', { staffOnly: e.target.checked })} /> Team posts only</label>
              <span className="ml-auto flex gap-1">
                <button className="btn-ghost h-7 w-7 px-0" disabled={i === 0} aria-label="Move up" title="Move up" onClick={async () => { await ch(`/${x.id}`, 'PUT', { position: i - 1 }); await ch(`/${c.channels[i - 1].id}`, 'PUT', { position: i }); }}><Icon name="chevronDown" className="h-4 w-4 rotate-180" /></button>
                <button className="btn-ghost h-7 w-7 px-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete #${x.name}`} title="Delete channel" onClick={() => confirm(`Delete #${x.name}? Its posts are hidden with it.`) && ch(`/${x.id}`, 'DELETE')}><Icon name="trash" className="h-3.5 w-3.5" /></button>
              </span>
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ch('', 'POST', { name: newChannel }).then(() => setNewChannel('')); }}>
          <input aria-label="New channel name" className="input h-9" placeholder="New channel, e.g. Wins" value={newChannel} onChange={(e) => setNewChannel(e.target.value)} />
          <button className="btn-secondary" disabled={!newChannel.trim()}><Icon name="plus" /> Add</button>
        </form>
      </section>
    </div>
  );
}
