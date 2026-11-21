// End-to-end API smoke test. Requires the API running (npm run dev:backend).
// Usage: node scripts/smoke-test.mjs [baseUrl]
const BASE = process.argv[2] || process.env.API_URL || 'http://localhost:3001/api/v1';
let failures = 0;

async function call(method, path, { token, body, expect = [200, 201] } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path} -> ${res.status}`);
  if (!ok) {
    failures++;
    console.log('   ', JSON.stringify(data).slice(0, 400));
  }
  return data;
}

function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = Math.random().toString(36).slice(2, 8);

await call('GET', '/health');

// --- Auth ---
const reg = await call('POST', '/auth/register', {
  body: { email: `smoke-${rand}@test.local`, password: 'SmokeTest123!', name: 'Smoke Tester' },
});
let token = reg.accessToken;
const me = await call('GET', '/auth/me', { token });
check('me has workspace', !!me.currentWorkspaceId);
check('me has contacts:write permission', me.permissions?.includes('contacts:write'));
const refreshed = await call('POST', '/auth/refresh', { body: { refreshToken: reg.refreshToken } });
check('refresh issues new tokens', !!refreshed.accessToken && refreshed.refreshToken !== reg.refreshToken);
await call('POST', '/auth/refresh', { body: { refreshToken: reg.refreshToken }, expect: 401 });
token = refreshed.accessToken;
await call('GET', '/workspaces', { token });
await call('GET', '/organizations', { token });
await call('GET', '/crm/contacts', { expect: 401 });

// --- Automation: welcome workflow fires on contact.created ---
const wf = await call('POST', '/automation/workflows', {
  token,
  body: {
    name: 'Tag VIPs',
    triggerType: 'contact.created',
    isPublished: true,
    steps: [
      {
        type: 'condition',
        config: { field: 'contact.email', operator: 'contains', value: '@vip.com' },
        then: [{ type: 'add_tag', config: { tag: 'vip' } }, { type: 'send_email', config: { subject: 'Hi {{contact.firstName}}', body: 'Welcome' } }],
        else: [{ type: 'log', config: { message: 'not vip' } }],
      },
    ],
  },
});
await call('POST', '/automation/workflows', { token, body: { name: 'bad', steps: [{ type: 'explode' }] }, expect: 400 });

// --- CRM ---
const c1 = await call('POST', '/crm/contacts', {
  token,
  body: { firstName: 'Grace', lastName: 'Hopper', email: 'grace@vip.com', companyName: 'Navy', tags: ['Founder'] },
});
const c2 = await call('POST', '/crm/contacts', { token, body: { firstName: 'Alan', lastName: 'Turing', email: 'alan@example.com', status: 'customer' } });
await call('POST', '/crm/contacts', { token, body: { firstName: 'Dup', email: 'GRACE@vip.com' }, expect: 409 });
await call('POST', '/crm/contacts', { token, body: { lastName: 'NoFirst' }, expect: 400 });
const search = await call('GET', '/crm/contacts?search=navy', { token });
check('search by company name', search.total === 1 && search.items[0].id === c1.id);
const byStatus = await call('GET', '/crm/contacts?status=customer', { token });
check('filter by status', byStatus.total === 1 && byStatus.items[0].id === c2.id);
await call('PUT', `/crm/contacts/${c2.id}`, { token, body: { tags: ['newsletter'], phone: '+15551234' } });
const byTag = await call('GET', '/crm/contacts?tag=newsletter', { token });
check('filter by tag', byTag.total === 1);
await call('GET', '/crm/companies', { token });

await sleep(800);
const graceAfter = await call('GET', `/crm/contacts/${c1.id}`, { token });
check('workflow added vip tag', graceAfter.tags.includes('vip'), JSON.stringify(graceAfter.tags));
const runs = await call('GET', `/automation/workflows/${wf.id}/runs`, { token });
check('workflow runs recorded', runs.length === 2 && runs.every((r) => r.status === 'succeeded'), runs.map((r) => r.status).join(','));
const manual = await call('POST', `/automation/workflows/${wf.id}/trigger`, { token, body: { contactId: c2.id } });
check('manual trigger takes else branch', manual.status === 'succeeded' && manual.log.some((l) => l.result === 'not vip'));

// --- Sales ---
const pipelines = await call('GET', '/sales/pipelines', { token });
check('default pipeline created', pipelines.length === 1 && pipelines[0].stages.length === 6);
const p = pipelines[0];
const won = p.stages.find((s) => s.name === 'Won');
const o1 = await call('POST', '/sales/opportunities', { token, body: { title: 'Deal A', value: 1000, pipelineId: p.id, contactId: c2.id } });
const o2 = await call('POST', '/sales/opportunities', { token, body: { title: 'Deal B', value: 2500.5, pipelineId: p.id } });
check('opportunity defaults to first stage', o1.stageId === p.stages[0].id);
await call('PUT', `/sales/opportunities/${o2.id}/stage`, { token, body: { stageId: won.id } });
const moved = await call('PUT', `/sales/opportunities/${o1.id}/stage`, { token, body: { stage: 'won', position: 0 } });
check('moved to Won with status won', moved.stageId === won.id && moved.status === 'won');
const board = await call('GET', `/sales/pipelines/${p.id}/opportunities`, { token });
const wonCol = board.stages.find((s) => s.id === won.id);
check('board ordering after drop', wonCol.opportunities.map((o) => o.title).join() === 'Deal A,Deal B');
check('board totals', wonCol.totalValue === 3500.5, String(wonCol.totalValue));

// --- Inbox ---
const sent = await call('POST', '/inbox/messages', { token, body: { contactId: c2.id, channel: 'email', subject: 'Hello', body: 'Test email' } });
check('email sent (console provider)', sent.status === 'sent');
await call('POST', '/inbox/inbound', { token, body: { contactId: c2.id, channel: 'email', body: 'Reply from Alan' } });
const sms = await call('POST', '/inbox/messages', { token, body: { contactId: c2.id, channel: 'sms', body: 'Hi via sms' } });
check('sms sent', sms.status === 'sent');
const convs = await call('GET', '/inbox/conversations', { token });
const emailConv = convs.find((c) => c.channel === 'email' && c.contactId === c2.id);
check('conversation unread count', emailConv?.unreadCount === 1);
const thread = await call('GET', `/inbox/conversations/${emailConv.id}`, { token });
check('thread has messages', thread.messages.length === 2);
await call('PUT', `/inbox/conversations/${emailConv.id}/read`, { token });

// --- Dashboard ---
const stats = await call('GET', '/dashboard/stats', { token });
check('dashboard revenue', stats.totalRevenue === 3500.5, String(stats.totalRevenue));

// --- Tenant isolation (NFR-03) ---
const other = await call('POST', '/auth/register', { body: { email: `other-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
await call('GET', `/crm/contacts/${c1.id}`, { token: other.accessToken, expect: 404 });
const otherList = await call('GET', '/crm/contacts', { token: other.accessToken });
check('other tenant sees no contacts', otherList.total === 0);
const res = await fetch(BASE + '/crm/contacts', {
  headers: { Authorization: `Bearer ${other.accessToken}`, 'x-workspace-id': me.currentWorkspaceId },
});
check('foreign workspace header rejected', res.status === 403, String(res.status));

// --- Cleanup paths ---
await call('DELETE', `/sales/opportunities/${o2.id}`, { token });
await call('DELETE', `/crm/contacts/${c2.id}`, { token });
await call('GET', `/crm/contacts/${c2.id}`, { token, expect: 404 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
