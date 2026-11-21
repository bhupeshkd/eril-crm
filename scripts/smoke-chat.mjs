// End-to-end checks for the website chat widget (settings, visitor sessions, staff replies, privacy).
// Usage: node scripts/smoke-chat.mjs [baseUrl]   (API must be running)
const BASE = process.argv[2] || process.env.API_URL || 'http://localhost:3001/api/v1';
let failures = 0;
async function call(method, path, { token, chat, body, expect = [200, 201] } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(chat ? { 'x-chat-token': chat } : {}) },
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
const reg = await call('POST', '/auth/register', { body: { email: `chat-${rand}@test.local`, password: 'SmokeTest123!', name: 'Maya Owner' } });
const T = { token: reg.accessToken };

// ---- Settings ----
const w = await call('GET', '/chat-widget', T);
check('widget created off, with an embed key', w.enabled === false && /^[A-Za-z0-9_-]{16,32}$/.test(w.publicKey));
check('key is stable', (await call('GET', '/chat-widget', T)).publicKey === w.publicKey);
const K = `/public/chat/widgets/${w.publicKey}`;
let cfg = await call('GET', K);
check('public config uses brand colour by default', cfg.enabled === false && /^#[0-9a-f]{6}$/.test(cfg.color) && cfg.askFor === 'email');
await call('POST', `${K}/sessions`, { body: { email: `v-${rand}@ex.test` }, expect: 403 });
await call('PUT', '/chat-widget', { ...T, body: { color: 'red' }, expect: 400 });
await call('PUT', '/chat-widget', { ...T, body: { askFor: 'phone' }, expect: 400 });
await call('PUT', '/chat-widget', { ...T, body: { publicKey: 'hijack' }, expect: 400 });
const saved = await call('PUT', '/chat-widget', { ...T, body: { enabled: true, title: 'Talk to Maya', greeting: 'Ask us anything', color: '#0EA5E9', position: 'left' } });
check('settings saved, colour lower-cased', saved.enabled && saved.color === '#0ea5e9' && saved.position === 'left' && saved.publicKey === w.publicKey);
cfg = await call('GET', K);
check('public config reflects settings', cfg.enabled && cfg.title === 'Talk to Maya' && cfg.color === '#0ea5e9' && cfg.businessName);
await call('GET', '/public/chat/widgets/nope', { expect: 404 });
await call('GET', '/public/chat/widgets/AAAAAAAAAAAAAAAAAAAAAA', { expect: 404 });

// ---- Visitor starts a chat ----
await call('POST', `${K}/sessions`, { body: {}, expect: 400 });
await call('POST', `${K}/sessions`, { body: { email: 'not-an-email' }, expect: 400 });
const v1 = await call('POST', `${K}/sessions`, { body: { name: 'Lena Park', email: `lena-${rand}@ex.test`, pageUrl: 'https://shop.example/pricing', message: 'Do you ship to Canada?' } });
check('session returns a token and the first message', v1.token?.length >= 40 && v1.messages.length === 1 && v1.messages[0].from === 'visitor');
const S1 = `/public/chat/sessions/${v1.sessionId}/messages`;

let convs = await call('GET', '/inbox/conversations?channel=chat', T);
const conv = convs.find((c) => c.channel === 'chat');
check('staff inbox shows the chat, unread', conv && conv.unreadCount === 1 && conv.lastMessagePreview === 'Do you ship to Canada?');
const contacts = await call('GET', `/crm/contacts?search=lena-${rand}`, T);
const lena = (contacts.items ?? contacts).find((c) => c.email === `lena-${rand}@ex.test`);
check('visitor became a contact with source chat', lena && lena.firstName === 'Lena' && lena.lastName === 'Park' && lena.source === 'chat');

// ---- Staff reply reaches the widget ----
const reply = await call('POST', '/inbox/messages', { ...T, body: { conversationId: conv.id, body: 'Yes! Shipping to Canada takes 3–5 days.' } });
check('reply delivered instantly', reply.status === 'sent' && reply.channel === 'chat');
let feed = await call('GET', S1, { chat: v1.token });
check('visitor sees the agent reply with first name', feed.messages.length === 2 && feed.messages[1].from === 'agent' && feed.messages[1].agent === 'Maya', JSON.stringify(feed.messages.at(-1)));
const cursor = feed.messages[1].createdAt;
await call('POST', S1, { chat: v1.token, body: { body: 'Great, thanks!' } });
feed = await call('GET', `${S1}?after=${encodeURIComponent(cursor)}`, { chat: v1.token });
check('polling with a cursor returns only newer messages', feed.messages.some((m) => m.body === 'Great, thanks!') && !feed.messages.some((m) => m.body === 'Do you ship to Canada?'));
await call('POST', S1, { chat: v1.token, body: { body: '' }, expect: 400 });
await call('POST', S1, { chat: v1.token, body: { body: 'x'.repeat(2001) }, expect: 400 });

// ---- Tokens and privacy ----
await call('GET', S1, { expect: 401 });
await call('GET', S1, { chat: 'wrong-token', expect: 401 });
await call('POST', S1, { chat: 'wrong-token', body: { body: 'spoof' }, expect: 401 });
await call('GET', `/public/chat/sessions/00000000-0000-4000-8000-000000000000/messages`, { chat: v1.token, expect: 401 });
// Someone typing Lena's email on another device joins the same contact for staff, but can't read her earlier messages.
const v2 = await call('POST', `${K}/sessions`, { body: { email: `LENA-${rand}@ex.test` } });
check('new session starts empty', v2.messages.length === 0);
feed = await call('GET', `/public/chat/sessions/${v2.sessionId}/messages`, { chat: v2.token });
check('earlier messages stay private', feed.messages.length === 0);
convs = await call('GET', '/inbox/conversations?channel=chat', T);
check('still one conversation for the contact', convs.filter((c) => c.contactId === lena.id).length === 1);

// ---- Anonymous mode ----
await call('PUT', '/chat-widget', { ...T, body: { askFor: 'none' } });
const anon = await call('POST', `${K}/sessions`, { body: { message: 'Hello?' } });
check('anonymous visitor allowed', anon.messages.length === 1);
convs = await call('GET', '/inbox/conversations?channel=chat', T);
check('anonymous chat shows as Website visitor', convs.some((c) => c.contact?.firstName === 'Website visitor'));
await call('PUT', '/chat-widget', { ...T, body: { askFor: 'name_email' } });
await call('POST', `${K}/sessions`, { body: { email: `n-${rand}@ex.test` }, expect: 400 });

// ---- Chats can be answered but not started by staff ----
const cold = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Cold', email: `cold-${rand}@ex.test` } });
await call('POST', '/inbox/messages', { ...T, body: { contactId: cold.id, channel: 'chat', body: 'Hi' }, expect: 400 });

// ---- Turning chat off stops visitors posting ----
await call('PUT', '/chat-widget', { ...T, body: { enabled: false } });
await call('POST', S1, { chat: v1.token, body: { body: 'Anyone there?' }, expect: 403 });
await call('GET', S1, { chat: v1.token }); // reading history still works

// ---- Isolation ----
const other = await call('POST', '/auth/register', { body: { email: `chat-o-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
check('other workspace has its own key', (await call('GET', '/chat-widget', { token: other.accessToken })).publicKey !== w.publicKey);
await call('GET', `/inbox/conversations/${conv.id}`, { token: other.accessToken, expect: 404 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
