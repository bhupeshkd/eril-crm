// End-to-end checks for team management: invitations, accepting, roles and removal.
// Usage: node scripts/smoke-team.mjs [baseUrl]   (API running, console email)
// The accept endpoint allows 10 requests a minute per IP, so wait a minute between runs.
const BASE = process.argv[2] || process.env.API_URL || 'http://localhost:3001/api/v1';
let failures = 0;
async function call(method, path, { token, body, expect = [200, 201] } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path.replace(/[0-9a-f]{64}/, '<token>')} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', JSON.stringify(data).slice(0, 300)); }
  return data;
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
const tokenOf = (url) => url.split('/').pop();
const rand = Math.random().toString(36).slice(2, 8);
const PW = 'SmokeTest123!';

const reg = await call('POST', '/auth/register', { body: { email: `owner-${rand}@test.local`, password: PW, name: 'Olive Owner' } });
const O = { token: reg.accessToken };
const ws = claims(reg.accessToken).currentWorkspaceId;
const ownerId = claims(reg.accessToken).sub;

// ---- Inviting ----
await call('POST', `/workspaces/${ws}/invite`, { ...O, body: { email: 'not-an-email', role: 'team_member' }, expect: 400 });
await call('POST', `/workspaces/${ws}/invite`, { ...O, body: { email: `x-${rand}@test.local`, role: 'super_admin' }, expect: 400 });
const first = await call('POST', `/workspaces/${ws}/invite`, { ...O, body: { email: `Sam-${rand}@Test.local`, role: 'sales_agent' } });
check('invite email is lower-cased', first.email === `sam-${rand}@test.local`);
const again = await call('POST', `/workspaces/${ws}/invite`, { ...O, body: { email: `sam-${rand}@test.local`, role: 'manager' } });
check('re-inviting reuses the invitation', again.id === first.id);
let pending = await call('GET', `/workspaces/${ws}/invitations`, O);
check('one pending invitation with the updated role', pending.length === 1 && pending[0].role === 'manager');
await call('GET', `/auth/invitations/${tokenOf(first.inviteUrl)}`, { expect: 404 });

// ---- Accepting as a new account ----
const samToken = tokenOf(again.inviteUrl);
const info = await call('GET', `/auth/invitations/${samToken}`);
check('invite info', info.status === 'pending' && info.hasAccount === false && info.invitedBy === 'Olive Owner');
await call('POST', `/auth/invitations/${samToken}/accept`, { body: { password: PW }, expect: 400 }); // no name
await call('POST', `/auth/invitations/${samToken}/accept`, { body: { name: 'Sam', password: 'short' }, expect: 400 });
const samAuth = await call('POST', `/auth/invitations/${samToken}/accept`, { body: { name: 'Sam', password: PW } });
const S = { token: samAuth.accessToken };
check('accepted user lands in the workspace', claims(samAuth.accessToken).currentWorkspaceId === ws);
check('accepted user gets the invited role', claims(samAuth.accessToken).workspaceMemberships.find((m) => m.workspaceId === ws)?.role === 'manager');
await call('POST', `/auth/invitations/${samToken}/accept`, { body: { name: 'Sam', password: PW }, expect: 400 });
check('accepted invitation is no longer pending', (await call('GET', `/workspaces/${ws}/invitations`, O)).length === 0);
await call('POST', `/workspaces/${ws}/invite`, { ...O, body: { email: `sam-${rand}@test.local`, role: 'manager' }, expect: 409 });
const samId = claims(samAuth.accessToken).sub;

// ---- Permissions ----
await call('POST', `/workspaces/${ws}/invite`, { ...S, body: { email: `y-${rand}@test.local`, role: 'team_member' }, expect: 403 });
await call('PUT', `/workspaces/${ws}/members/${ownerId}`, { ...S, body: { role: 'team_member' }, expect: 403 });
await call('DELETE', `/workspaces/${ws}/members/${ownerId}`, { ...S, expect: 403 });
await call('PUT', `/workspaces/${ws}/members/${ownerId}`, { ...O, body: { role: 'workspace_admin' }, expect: 400 }); // last owner
await call('DELETE', `/workspaces/${ws}/members/${ownerId}`, { ...O, expect: 400 }); // last owner can't leave
await call('PUT', `/workspaces/${ws}/members/${samId}`, { ...O, body: { role: 'workspace_admin' } });
const samAdmin = await call('POST', '/auth/login', { body: { email: `sam-${rand}@test.local`, password: PW } });
const SA = { token: samAdmin.accessToken };
check('role change reaches the token', claims(samAdmin.accessToken).permissions.includes('users:invite'));
await call('PUT', `/workspaces/${ws}/members/${samId}`, { ...SA, body: { role: 'workspace_owner' }, expect: 403 });
await call('PUT', `/workspaces/${ws}/members/${ownerId}`, { ...SA, body: { role: 'team_member' }, expect: 403 });

// ---- Admin manages invitations; existing account accepts ----
const other = await call('POST', '/auth/register', { body: { email: `pat-${rand}@test.local`, password: PW, name: 'Pat' } });
const patInvite = await call('POST', `/workspaces/${ws}/invite`, { ...SA, body: { email: `pat-${rand}@test.local`, role: 'team_member' } });
const resent = await call('POST', `/workspaces/${ws}/invitations/${patInvite.id}/resend`, SA);
check('resend issues a new link', tokenOf(resent.inviteUrl) !== tokenOf(patInvite.inviteUrl));
const patToken = tokenOf(resent.inviteUrl);
check('invite info knows Pat has an account', (await call('GET', `/auth/invitations/${patToken}`)).hasAccount === true);
await call('POST', `/auth/invitations/${patToken}/accept`, { body: { password: 'WrongPass99!' }, expect: 401 });
const patAuth = await call('POST', `/auth/invitations/${patToken}/accept`, { body: { password: PW } });
const patWs = claims(patAuth.accessToken).workspaceMemberships.map((m) => m.workspaceId);
check('existing account keeps its own workspace and gains the new one', patWs.includes(ws) && patWs.includes(claims(other.accessToken).currentWorkspaceId));

const revokeMe = await call('POST', `/workspaces/${ws}/invite`, { ...SA, body: { email: `gone-${rand}@test.local`, role: 'team_member' } });
await call('DELETE', `/workspaces/${ws}/invitations/${revokeMe.id}`, SA);
await call('GET', `/auth/invitations/${tokenOf(revokeMe.inviteUrl)}`, { expect: 404 });
await call('DELETE', `/workspaces/${ws}/invitations/${revokeMe.id}`, { ...SA, expect: 404 });

// ---- Members list, removal, leaving ----
let members = await call('GET', `/workspaces/${ws}/members`, O);
check('members list has three people with join dates', members.length === 3 && members.every((m) => m.joinedAt));
const patId = claims(patAuth.accessToken).sub;
await call('DELETE', `/workspaces/${ws}/members/${patId}`, SA);
await call('DELETE', `/workspaces/${ws}/members/${samId}`, SA); // admin leaves
members = await call('GET', `/workspaces/${ws}/members`, O);
check('only the owner remains', members.length === 1 && members[0].userId === ownerId);
await call('GET', `/workspaces/${ws}/members`, { ...SA, expect: 404 }); // no longer a member

console.log(failures ? `\n${failures} check(s) failed` : '\nAll team checks passed');
process.exit(failures ? 1 : 0);
