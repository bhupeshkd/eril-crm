'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, timeAgo } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modal, Spinner, errorText, useToast } from './ui';
import { Icon } from './icons';
import { ContactAvatar } from './contact-avatar';

interface Member { userId: string; email: string; name: string; role: string; joinedAt: string; lastLoginAt: string | null }
interface Invite { id: string; email: string; role: string; invitedBy: string | null; createdAt: string; expiresAt: string; inviteUrl: string }

/** Order matters: shown top-to-bottom in pickers. Descriptions match DEFAULT_ROLE_PERMISSIONS in @eril/shared. */
export const ROLES: Array<{ id: string; label: string; desc: string }> = [
  { id: 'workspace_owner', label: 'Owner', desc: 'Full access, and can add or remove other owners.' },
  { id: 'workspace_admin', label: 'Admin', desc: 'Full access including team and settings, but can’t add or change owners.' },
  { id: 'manager', label: 'Manager', desc: 'Contacts, deals, inbox, automations, forms and calendars. Can view payments.' },
  { id: 'marketing_manager', label: 'Marketing manager', desc: 'Campaigns, sites, funnels and forms, plus contacts and inbox.' },
  { id: 'sales_agent', label: 'Sales agent', desc: 'Contacts, deals, inbox and calendars.' },
  { id: 'team_member', label: 'Team member', desc: 'Contacts, inbox and calendars; can update deals.' },
];
const roleLabel = (r: string) => ROLES.find((x) => x.id === r)?.label ?? r.replace(/_/g, ' ');
const ROLE_TONE: Record<string, string> = {
  workspace_owner: 'bg-brand-50 text-brand-700 ring-brand-600/15',
  workspace_admin: 'bg-violet-50 text-violet-700 ring-violet-600/15',
};

export function TeamSettings() {
  const toast = useToast();
  const { me, switchWorkspace, logout } = useAuth();
  const wsId = me?.currentWorkspaceId ?? '';
  const myRole = me?.workspaceMemberships.find((m) => m.workspaceId === wsId)?.role ?? '';
  const isOwner = myRole === 'workspace_owner';
  const canManage = isOwner || myRole === 'workspace_admin';

  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviting, setInviting] = useState(false);

  const load = useCallback(() => {
    if (!wsId) return;
    api<Member[]>(`/workspaces/${wsId}/members`).then(setMembers).catch((e) => toast(errorText(e), 'error'));
    api<Invite[]>(`/workspaces/${wsId}/invitations`).then(setInvites).catch(() => setInvites([]));
  }, [wsId, toast]);
  useEffect(load, [load]);

  const owners = members?.filter((m) => m.role === 'workspace_owner').length ?? 0;
  /** Which roles the current user may hand out / take away. */
  const canEdit = (m: Member) => canManage && (isOwner || m.role !== 'workspace_owner') && !(m.role === 'workspace_owner' && owners <= 1);
  const assignable = ROLES.filter((r) => isOwner || r.id !== 'workspace_owner');

  async function changeRole(m: Member, role: string) {
    try {
      await api(`/workspaces/${wsId}/members/${m.userId}`, { method: 'PUT', body: { role } });
      toast(`${m.name || m.email} is now ${roleLabel(role)}`);
      // Our own permissions live in the access token: reissue it so the change applies now.
      if (m.userId === me?.id) await switchWorkspace(wsId);
      load();
    } catch (e) {
      toast(errorText(e), 'error');
      load();
    }
  }

  async function remove(m: Member) {
    const self = m.userId === me?.id;
    const ws = me?.workspaceMemberships.find((x) => x.workspaceId === wsId)?.workspaceName ?? 'this workspace';
    if (!confirm(self ? `Leave ${ws}? You'll lose access until someone invites you again.` : `Remove ${m.name || m.email} from ${ws}? They'll lose access straight away.`)) return;
    try {
      await api(`/workspaces/${wsId}/members/${m.userId}`, { method: 'DELETE' });
      if (self) {
        const other = me?.workspaceMemberships.find((x) => x.workspaceId !== wsId);
        if (other) await switchWorkspace(other.workspaceId);
        else await logout();
        location.href = other ? '/dashboard' : '/login';
        return;
      }
      toast(`${m.name || m.email} removed`);
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  async function inviteAction(inv: Invite, action: 'copy' | 'resend' | 'revoke') {
    try {
      if (action === 'copy') {
        await navigator.clipboard.writeText(inv.inviteUrl);
        toast('Invite link copied');
        return;
      }
      if (action === 'revoke' && !confirm(`Cancel the invitation for ${inv.email}? The link will stop working.`)) return;
      await api(`/workspaces/${wsId}/invitations/${inv.id}${action === 'resend' ? '/resend' : ''}`, { method: action === 'resend' ? 'POST' : 'DELETE' });
      toast(action === 'resend' ? `Invitation re-sent to ${inv.email}` : 'Invitation cancelled');
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <section className="card mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="font-semibold">Team</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">People who can sign in to this workspace, and what each of them can do.</p>
        </div>
        {canManage && <button className="btn-primary" onClick={() => setInviting(true)}><Icon name="plus" /> Invite teammate</button>}
      </div>

      {!members ? (
        <div className="grid h-24 place-items-center"><Spinner /></div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {members.map((m) => {
            const self = m.userId === me?.id;
            const editable = canEdit(m) && !self;
            const lastOwner = m.role === 'workspace_owner' && owners <= 1;
            return (
              <li key={m.userId} className="group flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-slate-50/70">
                <ContactAvatar c={{ firstName: m.name?.split(' ')[0] ?? '', lastName: m.name?.split(' ').slice(1).join(' ') ?? '', email: m.email }} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate font-medium text-slate-900">
                    {m.name || m.email}
                    {self && <span className="badge bg-slate-100 text-slate-600">You</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {m.email} · joined {timeAgo(m.joinedAt)}
                    {m.lastLoginAt ? ` · active ${timeAgo(m.lastLoginAt)}` : ' · hasn’t signed in yet'}
                  </p>
                </div>
                {editable ? (
                  <select aria-label={`Role for ${m.name || m.email}`} className="input h-8 w-auto py-0 pl-2.5 text-[13px]" value={m.role} onChange={(e) => changeRole(m, e.target.value)}>
                    {assignable.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                ) : (
                  <span className={`badge ${ROLE_TONE[m.role] ?? 'bg-slate-100 text-slate-600'}`} title={lastOwner ? 'The only owner — add another owner before changing this role' : undefined}>
                    {roleLabel(m.role)}
                  </span>
                )}
                {(editable || (self && !lastOwner)) ? (
                  <button
                    className="btn-ghost h-8 px-2 text-[13px] text-slate-400 opacity-0 hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => remove(m)}
                  >
                    {self ? 'Leave' : <><Icon name="trash" className="h-3.5 w-3.5" /><span className="sr-only">Remove {m.name || m.email}</span></>}
                  </button>
                ) : <span className="w-8" />}
              </li>
            );
          })}
        </ul>
      )}

      {invites.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pending invitations · {invites.length}</h3>
          <ul className="space-y-2">
            {invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-400"><Icon name="mail" className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="truncate text-xs text-slate-500">
                    {roleLabel(inv.role)} · invited {timeAgo(inv.createdAt)}{inv.invitedBy ? ` by ${inv.invitedBy}` : ''} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <button className="btn-ghost h-8 px-2 text-[13px]" onClick={() => inviteAction(inv, 'copy')}><Icon name="copy" className="h-3.5 w-3.5" /> Copy link</button>
                    <button className="btn-ghost h-8 px-2 text-[13px]" onClick={() => inviteAction(inv, 'resend')}><Icon name="send" className="h-3.5 w-3.5" /> Resend</button>
                    <button className="btn-ghost h-8 w-8 px-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Cancel invitation for ${inv.email}`} title="Cancel invitation" onClick={() => inviteAction(inv, 'revoke')}>
                      <Icon name="close" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal open={inviting} title="Invite a teammate" onClose={() => setInviting(false)}>
        {inviting && (
          <InviteForm
            workspaceId={wsId}
            roles={assignable}
            onDone={(r) => {
              setInviting(false);
              load();
              toast(`Invitation sent to ${r.email}`);
            }}
          />
        )}
      </Modal>
    </section>
  );
}

function InviteForm({ workspaceId, roles, onDone }: { workspaceId: string; roles: typeof ROLES; onDone: (r: { email: string }) => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('team_member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          onDone(await api<{ email: string }>(`/workspaces/${workspaceId}/invite`, { method: 'POST', body: { email, role } }));
        } catch (err) {
          setError(errorText(err));
          setBusy(false);
        }
      }}
    >
      <div>
        <label className="label" htmlFor="inv-email">Email address</label>
        <input id="inv-email" type="email" required autoComplete="off" className="input" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <p className="mt-1.5 text-xs text-slate-500">They’ll get an email with a link to join. It works for 7 days.</p>
      </div>
      <fieldset>
        <legend className="label">Role</legend>
        <div className="grid gap-1.5">
          {roles.map((r) => (
            <label key={r.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${role === r.id ? 'border-brand-500 bg-brand-50/60 ring-4 ring-brand-500/10' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
              <input type="radio" name="inv-role" className="mt-0.5" checked={role === r.id} onChange={() => setRole(r.id)} />
              <span><span className="font-medium text-slate-900">{r.label}</span><span className="block text-[13px] text-slate-500">{r.desc}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <button className="btn-primary" disabled={busy || !email.trim()}><Icon name="send" /> {busy ? 'Sending…' : 'Send invitation'}</button>
      </div>
    </form>
  );
}
