// End-to-end checks for courses/memberships and the agency console.
// Usage: node scripts/smoke-courses-agency.mjs [baseUrl]   (API must be running)
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
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', JSON.stringify(data).slice(0, 400)); }
  return data;
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = Math.random().toString(36).slice(2, 8);

const reg = await call('POST', '/auth/register', { body: { email: `agency-${rand}@test.local`, password: 'SmokeTest123!', name: 'Agency Owner', organizationName: `Agency ${rand}` } });
let token = reg.accessToken;
const me = await call('GET', '/auth/me', { token });
const homeWs = me.currentWorkspaceId;

// ================= COURSES =================
const T = () => ({ token });
const course = await call('POST', '/courses', { ...T(), body: { title: 'SEO Bootcamp', description: 'Rank higher in 30 days' } });
check('course created with starter module', course.modules.length === 1 && course.modules[0].lessons.length === 1);
await call('PUT', `/courses/${course.id}`, { ...T(), body: { modules: [{ title: 'M', lessons: [{ title: 'Bad', type: 'video', videoUrl: 'javascript:alert(1)' }] }] }, expect: 400 });
const updated = await call('PUT', `/courses/${course.id}`, { ...T(), body: {
  modules: [
    { id: course.modules[0].id, title: 'Basics', lessons: [{ ...course.modules[0].lessons[0], title: 'Welcome' }, { title: 'Keyword research', type: 'video', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationMinutes: 12 }] },
    { title: 'Advanced', lessons: [{ title: 'Link building', type: 'text', body: 'Earn links by...' }] },
  ] } });
check('lesson ids preserved on edit', updated.modules[0].lessons[0].id === course.modules[0].lessons[0].id);
const contact = await call('POST', '/crm/contacts', { ...T(), body: { firstName: 'Sam', lastName: 'Student', email: `sam-${rand}@ex.test` } });
await call('POST', `/courses/${course.id}/enrollments`, { ...T(), body: { contactId: contact.id }, expect: 400 }); // unpublished
await call('PUT', `/courses/${course.id}`, { ...T(), body: { isPublished: true } });

// Workflow: completing the course tags the contact.
await call('POST', '/automation/workflows', { ...T(), body: { name: 'Graduate', triggerType: 'course.completed', triggerConfig: { courseId: course.id }, isPublished: true,
  steps: [{ type: 'add_tag', config: { tag: 'graduate' } }] } });

const enr = await call('POST', `/courses/${course.id}/enrollments`, { ...T(), body: { contactId: contact.id } });
check('enrollment returns portal link', enr.created && enr.link.includes('/learn/'));
const again = await call('POST', `/courses/${course.id}/enrollments`, { ...T(), body: { contactId: contact.id, notify: false } });
check('enrollment is idempotent', again.created === false && again.link === enr.link);
const portalToken = enr.link.split('/learn/')[1];
const portal = await call('GET', `/public/learn/${portalToken}`);
check('portal shows course + 0%', portal.course.modules.length === 2 && portal.progress.percent === 0 && portal.member === 'Sam');
const lessonIds = portal.course.modules.flatMap((m) => m.lessons.map((l) => l.id));
await call('PUT', `/public/learn/${portalToken}/lessons/nope`, { body: { done: true }, expect: 404 });
let p;
for (const id of lessonIds) p = await call('PUT', `/public/learn/${portalToken}/lessons/${id}`, { body: { done: true } });
check('course completed at 100%', p.progress.percent === 100 && !!p.completedAt);
await sleep(1000);
const sam = await call('GET', `/crm/contacts/${contact.id}`, T());
check('course.completed workflow tagged graduate', sam.tags.includes('graduate'), JSON.stringify(sam.tags));
const list = await call('GET', '/courses', T());
check('course list stats', list[0].enrolled === 1 && list[0].completed === 1 && list[0].lessonCount === 3);
const roster = await call('GET', `/courses/${course.id}/enrollments`, T());
check('roster hides access tokens', roster.length === 1 && roster[0].accessToken === undefined && roster[0].progress.percent === 100);
const inbox = await call('GET', `/inbox/conversations?search=sam-${rand}`, T());
check('access email sent once', inbox.length === 1);
await call('DELETE', `/courses/enrollments/${roster[0].id}`, T());
await call('GET', `/public/learn/${portalToken}`, { expect: 404 });

// Workflow action: enroll_in_course
const c2 = await call('POST', '/crm/contacts', { ...T(), body: { firstName: 'Wanda', email: `wanda-${rand}@ex.test` } });
const wf = await call('POST', '/automation/workflows', { ...T(), body: { name: 'Enroll', steps: [{ type: 'enroll_in_course', config: { courseId: course.id } }] } });
const run = await call('POST', `/automation/workflows/${wf.id}/trigger`, { ...T(), body: { contactId: c2.id } });
check('workflow enrolls contact', run.status === 'succeeded' && run.log[0].result.includes('enrolled'), JSON.stringify(run.log));

// ================= AGENCY =================
const orgs = await call('GET', '/agency/organizations', T());
check('agency org listed', orgs.length === 1 && orgs[0].subAccounts === 1);
const orgId = orgs[0].id;
let subs = await call('GET', `/agency/${orgId}/sub-accounts`, T());
check('home sub-account with metrics', subs.length === 1 && subs[0].metrics.contacts === 2 && subs[0].myRole === 'workspace_owner');

// Snapshot the configured home account, then spin up a client account from it.
const form = await call('POST', '/forms', { ...T(), body: { name: 'Lead form' } });
const cal = await call('POST', '/calendars', { ...T(), body: { name: 'Discovery' } });
await call('POST', '/crm/custom-fields', { ...T(), body: { label: 'Budget', type: 'number' } });
await call('POST', '/automation/workflows', { ...T(), body: { name: 'Form → enroll', triggerType: 'form.submitted', triggerConfig: { formId: form.id }, isPublished: true, steps: [{ type: 'enroll_in_course', config: { courseId: course.id } }] } });
const site = await call('POST', '/sites', { ...T(), body: { name: 'Funnel', template: 'lead-funnel' } });
site.pages[1].blocks.find((b) => b.type === 'booking').props.calendarId = cal.id;
await call('PUT', `/sites/${site.id}`, { ...T(), body: { pages: site.pages } });
const snap = await call('POST', `/agency/${orgId}/snapshots`, { ...T(), body: { name: 'Agency starter', sourceWorkspaceId: homeWs } });
check('snapshot summary', snap.summary.forms === 1 && snap.summary.calendars === 1 && snap.summary.courses === 1 && snap.summary.sites === 1 && snap.summary.workflows >= 3, JSON.stringify(snap.summary));
const client = await call('POST', `/agency/${orgId}/sub-accounts`, { ...T(), body: { name: 'Client: Joe’s Plumbing', snapshotId: snap.id } });
subs = await call('GET', `/agency/${orgId}/sub-accounts`, T());
check('client sub-account added', subs.length === 2 && subs.some((s) => s.id === client.id));

// Switch into the client account and verify the imported setup with remapped references.
const sw = await call('POST', '/auth/switch-workspace', { ...T(), body: { workspaceId: client.id } });
token = sw.accessToken;
const cForms = await call('GET', '/forms', T());
const cCals = await call('GET', '/calendars', T());
const cCourses = await call('GET', '/courses', T());
const cWfs = await call('GET', '/automation/workflows', T());
const cSites = await call('GET', '/sites', T());
const cFields = await call('GET', '/crm/custom-fields', T());
check('imported assets', cForms.length === 1 && cCals.length === 1 && cCourses.length === 1 && cSites.length === 1 && cFields.length === 1);
check('imported assets got new ids/slugs', cForms[0].id !== form.id && cForms[0].slug !== form.slug && cCals[0].slug !== cal.slug);
const formWf = cWfs.find((w) => w.name === 'Form → enroll');
check('workflow references remapped', formWf.triggerConfig.formId === cForms[0].id && formWf.steps[0].config.courseId === cCourses[0].id);
check('imported workflows start unpublished', cWfs.every((w) => !w.isPublished));
const cSite = await call('GET', `/sites/${cSites[0].id}`, T());
check('site embed remapped', cSite.pages[1].blocks.find((b) => b.type === 'booking').props.calendarId === cCals[0].id && !cSite.isPublished);
const cContacts = await call('GET', '/crm/contacts', T());
check('contacts are NOT copied', cContacts.total === 0);
const cPipes = await call('GET', '/sales/pipelines', T());
check('pipeline copied once (no auto default)', cPipes.length === 1);

// Access control
const outsider = await call('POST', '/auth/register', { body: { email: `outsider-${rand}@test.local`, password: 'SmokeTest123!', name: 'Outsider' } });
await call('GET', `/agency/${orgId}/sub-accounts`, { token: outsider.accessToken, expect: 403 });
await call('POST', `/agency/${orgId}/snapshots/${snap.id}/apply`, { token: outsider.accessToken, body: { workspaceId: client.id }, expect: 403 });
const outsiderOrg = (await call('GET', '/agency/organizations', { token: outsider.accessToken }))[0];
await call('POST', `/agency/${orgId}/snapshots/${snap.id}/apply`, { ...T(), body: { workspaceId: outsider.accessToken ? (await call('GET', '/auth/me', { token: outsider.accessToken })).currentWorkspaceId : '' }, expect: 404 });
await call('POST', `/agency/${outsiderOrg.id}/sub-accounts`, { ...T(), body: { name: 'hijack' }, expect: 403 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
