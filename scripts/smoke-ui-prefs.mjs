// End-to-end checks for per-profile UI customization: Overview layout, appearance and the team default.
// Usage: node scripts/smoke-ui-prefs.mjs [baseUrl]   (API running)
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
  if (!ok) { failures++; console.log('   ', JSON.stringify(data).slice(0, 300)); }
  return data;
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
const rand = Math.random().toString(36).slice(2, 8);
const PW = 'SmokeTest123!';
const reg = await call('POST', '/auth/register', { body: { email: `ui-${rand}@test.local`, password: PW, name: 'Uma Ui' } });
const A = { token: reg.accessToken };
const reg2 = await call('POST', '/auth/register', { body: { email: `ui2-${rand}@test.local`, password: PW, name: 'Bo Other' } });
const B = { token: reg2.accessToken };

await call('GET', '/ui/preferences', { expect: 401 });

// ---- Defaults ----
let p = await call('GET', '/ui/preferences', A);
check('default layout has 9 widgets', p.layoutIsDefault && p.widgets.length === 9);
check('default appearance', p.appearanceSource === 'default' && p.appearance.accent === '#b6e633' && p.teamAppearance === null);

// ---- Layout ----
await call('PUT', '/ui/layout', { ...A, body: { widgets: [{ id: 'a', type: 'stocks' }] }, expect: 400 });
await call('PUT', '/ui/layout', { ...A, body: { widgets: [{ id: 'a', type: 'won' }, { id: 'b', type: 'won' }] }, expect: 400 });
await call('PUT', '/ui/layout', { ...A, body: { widgets: 'nope' }, expect: 400 });
const layout = [
  { id: 'n1', type: 'note', size: 'l', tint: 'custom', style: { from: '#112233', to: '#445566', angle: 90 }, title: 'Goals', config: { text: 'Close 5 deals' } },
  { id: 'won', type: 'won', size: 's', tint: 'sky' },
  { id: 's1', type: 'shortcuts', size: 'm', tint: 'none', config: { links: ['/pipeline', 'https://evil.example'] } },
];
p = await call('PUT', '/ui/layout', { ...A, body: { widgets: layout } });
check('layout saved in order', !p.layoutIsDefault && p.widgets.map((w) => w.id).join() === 'n1,won,s1');
check('custom gradient + title kept', p.widgets[0].style?.to === '#445566' && p.widgets[0].title === 'Goals' && p.widgets[0].config.text === 'Close 5 deals');
check('unsafe shortcut dropped', JSON.stringify(p.widgets[2].config.links) === '["/pipeline"]');
p = await call('GET', '/ui/preferences', A);
check('layout persists', p.widgets.length === 3 && p.widgets[0].id === 'n1');
const other = await call('GET', '/ui/preferences', B);
check("another person's layout is untouched", other.layoutIsDefault && other.widgets.length === 9);

// ---- Appearance ----
await call('PUT', '/ui/appearance', { ...A, body: { appearance: 'red' }, expect: 400 });
p = await call('PUT', '/ui/appearance', {
  ...A,
  body: { appearance: { preset: 'ocean', mode: 'dark', accent: '#38BDF8', accentEnd: 'expression(alert(1))', font: 'Manrope', surface: { style: 'solid', radius: 99 }, sidebar: { side: 'right' }, nav: { order: ['/inbox'], hidden: ['/settings', '/calls'] }, startPage: '//evil.example' } },
});
const a = p.appearance;
check('appearance is own', p.appearanceSource === 'own');
check('valid choices kept', a.mode === 'dark' && a.accent === '#38bdf8' && a.font === 'Manrope' && a.surface.style === 'solid' && a.sidebar.side === 'right');
check('unsafe values replaced', a.accentEnd === null && a.surface.radius === 32 && a.startPage === '/dashboard');
check('settings cannot be hidden', JSON.stringify(a.nav.hidden) === '["/calls"]');
check('layout untouched by appearance save', p.widgets.length === 3);

// ---- Team default ----
const team = await call('PUT', '/ui/team-appearance', { ...A, body: { appearance: { accent: '#f43f5e', preset: 'sunset' } } });
check('team look stored', team.teamAppearance?.accent === '#f43f5e');
p = await call('GET', '/ui/preferences', A);
check('own look still wins over the team look', p.appearanceSource === 'own' && p.appearance.accent === '#38bdf8');
p = await call('DELETE', '/ui/appearance', A);
check('after reset the team look applies', p.appearanceSource === 'team' && p.appearance.accent === '#f43f5e');
p = await call('DELETE', '/ui/team-appearance', A);
p = await call('GET', '/ui/preferences', A);
check('clearing the team look falls back to the original', p.appearanceSource === 'default' && p.teamAppearance === null);

// ---- Layout reset ----
p = await call('DELETE', '/ui/layout', A);
check('layout reset to default', p.layoutIsDefault && p.widgets.length === 9);

console.log(failures ? `\n${failures} FAILED` : '\nAll UI preference checks passed');
process.exit(failures ? 1 : 0);
