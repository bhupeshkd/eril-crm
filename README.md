# ERIL — All-in-One Business Operating System

Modular monolith: **NestJS + TypeORM + PostgreSQL** API and a **Next.js 14 + Tailwind** web app.

| Module | What it does | API prefix | UI |
|---|---|---|---|
| Auth & tenancy | Register/login, JWT + rotating refresh tokens, MFA, workspaces, RBAC | `/auth`, `/workspaces`, `/organizations` | `/login`, `/register` |
| CRM | Contacts & companies, search (name/email/company), status + tag filters | `/crm/contacts`, `/crm/companies` | `/contacts` |
| Sales | Pipelines with editable stages, opportunities, drag-and-drop Kanban | `/sales/pipelines`, `/sales/opportunities` | `/pipeline` |
| Automation | Event-driven workflows: triggers, actions, If/Else branches, run log | `/automation/workflows` | `/workflows` |
| Communication | Unified email/SMS inbox (SendGrid / Twilio, console in dev) | `/inbox` | `/inbox` |
| Dashboard | Revenue, pipeline, leads, appointments, tasks, unread KPIs and activity timeline | `/dashboard/stats` | `/dashboard` |
| CRM extras | Custom fields, notes, tasks, DND, contact source, bulk actions, CSV import/export | `/crm/custom-fields`, `/crm/tasks`, `/crm/contacts/{bulk,import,export}` | `/contacts`, `/tasks`, `/settings` |
| Marketing attribution | Public forms, booking pages, order forms, site pages and the chat widget capture UTM tags, ad click IDs (gclid, fbclid, msclkid), the referring site and landing page (from the host page when embedded). Each contact keeps a first and latest touch; Reporting shows leads, customers, conversion and lifetime revenue by channel and campaign under either model. Touches live in sessionStorage so one agency’s ad never credits another’s lead | `attribution` on public submit bodies, `/reports/attribution?model=first|last` | Reporting, contact details |
| White-label branding | Agency → Branding sets an app name, https logo and brand colour (a full shade scale is derived from one colour) for every sub-account in the organization, plus customer pages (booking, invoices, order forms, forms, reviews, courses, communities, join, invites, unsubscribe). Optionally hides “Powered by”. Public pages look branding up by their own link; unknown links get the default, so it can’t be used to probe tokens | `/agency/:orgId/branding`, `/branding`, `/public/branding/:kind/:key` | Agency (Branding tab), whole app |
| SaaS mode & rebilling | Agency → SaaS plans: pick the agency workspace that bills clients, create plans (price, monthly/yearly, trial, included feature areas, contact/user limits, monthly email/SMS allowances) and put sub-accounts on them. Each client becomes a tagged contact with a normal subscription in the billing workspace. Plans gate features (403 with an upgrade message), cap contacts and seats (402), and unpaid accounts go read-only after a grace period until the invoice is paid. Messages beyond the allowance are resold at your per-email/SMS price on one overage invoice per client per month (billed hourly for last month, never twice). Clients see a trial/overdue banner and Settings → plan & usage | `/agency/:orgId/saas/*`, `/saas/status` | Agency (SaaS plans tab), app banner, Settings |
| Working hours & reminders | Each person sets their own weekly hours, timezone and days off (managers can set anyone's). Team calendars only offer times when someone is working and only auto-assign people who are; staff can still book someone explicitly. Calendars can send up to 3 reminders (email or SMS, 5 minutes to 7 days before); a minute-by-minute scheduler sends each once, re-sends after a reschedule, skips cancelled appointments and do-not-disturb contacts, and never sends reminders that were already late when the booking was made or moved | `/calendars/member-hours`, `/calendars/reminders/run` | Calendars (Working hours tab, calendar settings) |
| Calendar sync (iCal) | Calendars → Sync gives each person a private feed link of their appointments to subscribe to in Google Calendar, Outlook or Apple Calendar (new link = old one revoked). Paste a calendar's secret iCal address to block those busy times: for yourself on team calendars, or (managers) for one booking calendar; refreshed every 15 minutes and on demand, keeping the last good copy if a refresh fails. The built-in parser handles timezones (incl. Outlook's Windows zone names), all-day events, DURATION, repeats (daily/weekly with days/monthly/yearly, INTERVAL, COUNT, UNTIL), EXDATE, moved occurrences and cancelled/free events. Links are fetched safely: https only, private/internal addresses refused (also after redirects), size and time limits | `/calendar-sync`, `/public/calendar-feed/:token.ics` | Calendars (Sync tab) |
| Website chat | Settings → Website chat gives a one-line embed (`/widget.js`) that adds a chat bubble to any site. It runs in an iframe served by the app, so the host site needs no API access or CORS changes. Visitors (optionally asked for email or name + email) become contacts with source `chat`; messages land in Conversations → Chat, staff reply from the inbox and the widget picks replies up within seconds, and the AI assistant can answer chats too. Each visitor session has its own secret token (stored hashed), and a visitor only ever sees messages from their own session, so entering someone else's email never reveals that contact's history. Chats can be answered but not started by staff; turning chat off stops new messages | `/chat-widget`, `/public/chat/*` | Settings (Website chat), Conversations (Chat filter) |
| Blogs | Each website has a blog at `/s/<site>/blog`: Markdown posts with a live-preview editor, cover image, author, tags, custom URL, SEO title/description, drafts and scheduling (a future publish date). Public pages use the site's theme, with tag filters, paging, reading time, newer/older links, view counts and an RSS feed. Bodies are rendered as React elements by a small Markdown renderer — never raw HTML — and only http(s)/mailto links and https images are allowed. The site nav gets a Blog link once a post is live | `/sites/:id/posts`, `/public/sites/:slug/blog[/…]`, `…/blog/rss.xml` | Sites → Blog |
| QR codes | Dynamic QR codes: the printed code points at a short scan link (`/public/qr/<code>`), so the destination can be changed or paused without reprinting; deleted codes are never reused. Optional UTM tags, colour and error-correction level; downloads as SVG or PNG; scans counted per day (30 days) and by device. The encoder is built in (byte mode, versions 1–10, levels L/M/Q/H) and verified against OpenCV | `/qr-codes`, `/public/qr/:code` | QR codes |
| Community files & levels | Posts can carry up to 3 attachments (PDF, Word/Excel/PowerPoint, ZIP, text, CSV, Markdown; 10 MB). The type is decided from the file's bytes — executables, HTML/SVG disguised as text and old macro-capable Office files are refused — names are cleaned to end in the real extension, and downloads are signed, short-lived and always served as attachments with `nosniff`. Members earn a point for every like their posts get from someone else (own likes don't count, the team's do); points set a level from 1 to 9, shown next to names, and a leaderboard ranks the top 10 for 7 days, 30 days or all time, with each member's own level progress | `/communities/:id/files`, `…/leaderboard`, `/public/community/:token/files`, `…/leaderboard` | Community feed (staff and member portal) |
| Custom domains | Sites → Domains connects a customer's own domain (up to 5 per site). Ownership is proved with a DNS TXT record (`_eril-verify.<domain>`), checked on demand and automatically every few minutes for 3 days; anyone may claim a name, but only a verified claim routes, at most one per hostname (a partial unique index), and verifying closes other accounts' pending claims. The frontend middleware serves the site on verified domains and never exposes the staff app there. `GET /public/domains/allowed?domain=` is an on-demand TLS "ask" endpoint so a proxy like Caddy only issues certificates for verified domains | `/sites/:id/domains`, `/public/domains/resolve`, `/public/domains/allowed` | Site editor → Domains |
| Phone & missed-call text-back | Settings → Phone connects business numbers (e.g. bought in Twilio): calls ring a staff phone for a set time; unanswered calls offer voicemail and automatically text the caller (template with `{{first_name}}`/`{{business}}`, a per-caller cooldown, skipped for do-not-disturb and withheld numbers, never twice for one call). Callers are matched to or created as contacts, every call is logged (Calls page: answered/missed/voicemail with recordings) and `call.missed` can start workflows and shows as a live notification. Webhooks must carry a valid `X-Twilio-Signature` when `TWILIO_AUTH_TOKEN` is set and are refused in production without it; a Test button simulates calls in development. Numbers can play a phone menu (up to 9 keys, each ringing a different phone; a wrong key gets one retry, no key rings the main phone) and record answered calls with a spoken notice. Contacts have a Call button: it rings your phone first, then connects the customer from the business number (`VOICE_PROVIDER=twilio`; console mode in development), and unanswered outgoing calls never send a text-back | `/phone/numbers`, `/phone/calls`, `/phone/calls/outbound`, `/public/voice/incoming` (+ `menu`, `dial-status`, `voicemail`, `recording`, `bridge`) | Calls, Settings → Phone |
| Two-way SMS & WhatsApp | Set a business number's "A message comes in" webhook to `/public/messaging/incoming`: texts and WhatsApp messages (Twilio, signature-checked) land in Conversations on the matching contact (created if new), with https attachments linked; Twilio retries are stored once. Outgoing texts go from the workspace's own number and report delivery back (`/public/messaging/status`; statuses only move forward, failures show the carrier error). Replying STOP sets the contact to do-not-disturb and START clears it; nobody can text a do-not-disturb contact. WhatsApp conversations can only be answered, and only within 24 hours of the customer's last message, as WhatsApp requires | `/public/messaging/incoming`, `/public/messaging/status` | Conversations (SMS/WhatsApp), Settings → Phone |
| Messenger & Instagram DMs | Settings → Facebook & Instagram connects a Page or Instagram account (id + page access token, stored server-side and never returned). Point your Meta app's webhooks (field `messages`) at `/public/meta/webhook`: the subscription handshake checks `META_VERIFY_TOKEN`, and events must carry `X-Hub-Signature-256` over the exact raw body (`META_APP_SECRET`). Messages land in Conversations on a contact per person (page-scoped id), retries and our own echoes are skipped, photos are linked. Replies go through the Graph Send API (`META_PROVIDER=meta`; console in development), only to people who wrote first and within 24 hours of their last message. Disconnecting a page stops new messages and replies | `/meta/pages`, `/public/meta/webhook` | Conversations (Messenger/Instagram), Settings |
| Social planner | Grow → Social planner composes posts (text, link, https image) for any connected Facebook Pages and Instagram accounts, saved as drafts, scheduled, or posted now. Each post is checked against every chosen platform first (Instagram needs an image and a 2,200-character caption; links become plain text there). A scheduler publishes due posts every 30 seconds, claiming each post so it's published exactly once even with simultaneous clicks or several servers, and records a result per account (published with its id, or failed with the reason) plus an overall published / partly published / failed. Publishing uses the Graph API (`META_PROVIDER=meta`; console in development) | `/social/accounts`, `/social/posts` | Social planner |
| AI assistant | Answers inbound SMS/email from the business info you give it, or hands off to a person (customer asks for one, complaints, refunds, anything it can’t answer, or a per-conversation reply limit). A hand-off pauses it in that conversation, sends an optional holding message and creates a task; a teammate replying also pauses it. Never messages do-not-disturb contacts. Settings has a “Try it” preview | `/ai/assistant` (+ `/preview`), `PUT /inbox/conversations/:id/bot` | Settings (AI assistant), Inbox |
| Smart lists | Save a contact filter (status, tag, source, date added, search) as a named list. Counts are live, lists open from pills on the Contacts page, and a campaign can target a list (status/tag chips narrow it further). Sending a campaign whose list was deleted is refused | `/crm/lists`, `/crm/contacts?listId=`, `/crm/contacts/sources`, `audience.listId` on campaigns | `/contacts`, Marketing |
| Calendars | Booking calendars with weekly availability, timezones, buffers; public booking page | `/calendars`, `/public/calendars/:slug` | `/calendars`, `/book/:slug` |
| Team management | Invite teammates by email (7-day link; re-inviting refreshes it), accept as a new or existing account, change roles, remove people or leave. Owners/admins manage the team; only owners grant or change the owner role, and a workspace always keeps at least one owner. Accepting is rate-limited (10/min per IP) | `/workspaces/:id/{members,invite,invitations}`, `/auth/invitations/:token` | `/settings` (Team), `/invite/:token` |
| Team calendars | Round-robin calendars shared by workspace users: a slot is open when any member is free (busy on any calendar counts), bookings rotate (round robin) or go to whoever has the fewest in 30 days (balanced). Staff can pick or reassign the host; optional contact-owner assignment; host name on confirmations and notifications. Bookings are serialised per workspace so two people can't take the same host | `/calendars` (`type: team`), `/calendars/:id/team`, `assignedUserId` on appointments | Calendars |
| Forms & surveys | Hosted/embeddable forms and step-by-step surveys that create contacts | `/forms`, `/public/forms/:slug` | `/forms`, `/f/:slug` |
| Payments | Products, invoices, hosted pay page (Stripe Checkout or test mode) | `/payments`, `/public/invoices/:token` | `/payments`, `/invoice/:token` |
| Text-to-pay | "💳 Request payment" on a conversation or contact: charge a custom amount or a one-time product, sent by SMS or email with an editable message ({{name}}, {{amount}}, {{description}}, {{link}}; the secure link is always included). Creates an invoice marked text-to-pay; when it's paid (online or marked paid) the customer gets one receipt on the same channel. Do-not-disturb contacts are blocked, and if the message can't be delivered the invoice is voided | `POST /payments/text-to-pay` | Conversations, Contacts, Payments |
| Order forms | Hosted one-step checkout at `/order/<slug>`: buyer picks a product, can tick an order bump and apply a coupon; tax and totals update live. Each order becomes an invoice paid on the existing pay page (Stripe or test mode), then shows the form's thank-you message and optional redirect. Monthly/yearly products charge the first period and start a subscription once paid. Buyers are tagged; views, orders, paid and revenue per form; `order.submitted` / `order.paid` workflow triggers | `/payments/order-forms`, public `/public/order-forms/:slug` | Payments → Order forms |
| Order quantities | Per form, "Let buyers choose a quantity" with a maximum (1–100). Buyers get a − / + picker for the main product (the order bump and upsells stay at one); totals, coupons and tax update live and the invoice line carries the quantity. Monthly/yearly products start a subscription with that many seats. Forms without quantities reject any quantity other than 1 | `allowQuantity`, `maxQuantity` on `/payments/order-forms`; `quantity` on the public order and coupon endpoints | Payments → Order forms |
| One-click upsells | Up to 3 post-purchase offers per order form, shown in order on the paid order page. Accepting charges the same payment method without re-entering details: Stripe Checkout saves the card (`setup_future_usage=off_session`) and the offer is charged off-session with an idempotency key; if the bank asks for authentication the buyer finishes on the normal pay page. Each offer is answered once (atomic claim) and only within 30 minutes of payment. Recurring upsells start a subscription; inactive offer products are skipped; per-form take rate and upsell revenue | `upsells` on `/payments/order-forms`, public `POST /public/order-forms/upsell/:token` | Payments → Order forms |
| Downsells | Each upsell can carry a cheaper fallback offer that appears only if the buyer declines that upsell, before the next upsell. Same one-click charge, offer window and atomic answering (the buyer can't skip the downsell or answer it twice); skipped if its product is switched off. Downsell take-up is shown per form and downsell invoices are labelled in the orders list | `downsell` on each entry in `upsells`, `kind` on `POST /public/order-forms/upsell/:token` | Payments → Order forms |
| Marketing | Email/SMS campaigns to status/tag segments, scheduling, signed unsubscribe links | `/campaigns`, `/public/unsubscribe` | `/campaigns`, `/unsubscribe` |

| AI assistant | Claude (`claude-opus-5-5`) drafts emails/SMS, suggests inbox replies, summarises contacts; `ai_generate` workflow step | `/ai/*` | contact page, inbox, campaigns |
| Real-time | Server-sent event stream per workspace: live toasts, notification feed, auto-refreshing inbox | `/realtime/stream` | bell menu |
| Reporting | Leads/day, payments/day, pipeline by stage, lead sources, show rate, win rate, forms, automation runs | `/reports/overview` | `/reporting` |
| Sites & funnels | Block-based page builder (hero, features, form, booking, pricing, reviews, FAQ…), funnel steps, publishing, page views | `/sites`, `/public/sites/:slug` | `/sites`, `/s/:slug/:path` |
| Reputation | Review requests (email/SMS), private feedback for low ratings, public-review redirect for happy customers, reviews on websites | `/reputation`, `/public/reviews/:token` | `/reputation`, `/review/:token` |
| Developer platform | Workspace API keys (`x-api-key`, role-scoped) and signed outbound webhooks with retries and auto-disable | `/developer/*` | Settings → Developer |
| Email template builder | Block-based designer (heading, text, button, image, columns, divider, spacer, footer) with theme colours, merge fields, live desktop/mobile preview, starter gallery, test sends; templates power campaigns and workflow emails (HTML + plain-text, unsubscribe link added to campaigns) | `/email-templates` | Marketing → Email templates |
| Open & click tracking | Designed emails get an open pixel and signed click redirects (no open redirects; unsubscribe links untouched; security-scanner hits ignored). Campaign reports (open/click rate, top links), inbox badges, `email.opened`/`email.clicked` workflow triggers, per-workspace on/off | `/campaigns/:id/report`, `/tracking/settings`, public `/t/o/*`, `/t/c/*` | Marketing, Settings → Email tracking |
| A/B subject tests | Test a second subject on 10–100% of an email campaign's audience (split evenly), pick the winner by open or click rate after 15 min–2 days (or end early / force a variant), then send it to everyone else. Ties keep the original subject | `abTest` on `/campaigns`, `POST /campaigns/:id/ab/winner`, `variants` in report | Marketing → campaign editor |
| Subscriptions & coupons | Monthly/yearly plans (products or custom), free trials, quantity, MRR; each cycle issues and emails an invoice, overdue invoices get one reminder and mark the plan past due until paid; cancel now or at period end. Coupons: % or fixed, once/forever/first-N payments, usage limits, expiry, invoice or subscription scope, customer entry on the pay page | `/payments/subscriptions`, `/payments/coupons` | Payments → Subscriptions / Coupons |
| Courses & memberships | Modules and video/text lessons, publish, enroll contacts (manually or by workflow), private magic-link member portal with progress tracking and completion triggers | `/courses`, `/public/learn/:token` | `/courses`, `/learn/:token` |
| Communities | Members-only spaces with channels (staff-only channels for announcements), posts, comments, likes and pinned posts. Members are contacts who open `/community/<token>` with a personal link (no password) and appear to others only by a display name. Moderators and staff can hide/pin; staff can ban, reset a leaked link or remove members. Open communities have a join page (`/join/<slug>`) that only ever emails the link, so it can't be used to take over a membership. Course enrollment can add students automatically; new members can be tagged; `community.member_joined` / `community.post_created` workflow triggers | `/communities`, public `/public/community/:token`, `/public/communities/:slug` | Communities |
| Community digests | Daily or weekly email of new posts per member, sent around a chosen hour in the community's timezone (skipped if the server was down for the whole 3-hour window). Only posts the member hasn't seen since their last digest or visit, never their own, hidden or deleted-channel posts; nothing is sent when nothing is new. Pinned and most-discussed posts first. Members change or stop it from their community page (the email footer links there); DND contacts are skipped. Each send is claimed atomically before emailing, and a failed send is retried next time. Member text is neutralised so a post can't plant links or formatting in the email. Staff can preview any member's next digest (personal link masked) | `/communities/:id/digests/preview`, dev-only `POST /communities/:id/digests/run` | Communities → Settings |
| Community @mentions | Type `@` in a post or comment to pick a member (search by display name; names only, never emails). A mention only counts if `@Their Name` is really in the text and they're an active member of that community, so clients can't silently notify people; up to 10 per post. Mentioned members see their name highlighted, get an `@ Mentions` inbox with unread count, and an email with a link straight to the post (`?post=`). Mention emails respect DND and a per-member opt-out, and are capped at 30 per author per hour (mentions beyond that still reach the inbox). Mentions of hidden/deleted content drop out of the inbox | `mentions` on post/comment bodies, `/public/community/:token/mention-search`, `/mentions`, `/mentions/read`; staff `/communities/:id/mention-search` | Communities, member portal |
| Community images | Members and staff add up to 4 photos to a post (photo-only posts allowed). JPEG, PNG, GIF and WebP up to 5 MB, recognised by their actual bytes (SVG and disguised files are rejected). Location/camera metadata (EXIF GPS, XMP, IPTC, PNG text) is stripped before storing. Images are stored in Postgres and shown through links signed for 1–2 hours, handed out only to people who can see the post; deleting a post makes its images stop loading. Served with `nosniff` and a sandboxing CSP. Uploads are limited to 20 a minute and 50 a day per person; unused uploads are removed after a day | `POST /public/community/:token/images`, `POST /communities/:id/images`, `imageIds` on posts, `GET /public/community-images/:id` | Communities, member portal |
| Agency console | All sub-accounts in an organization with live metrics, create/rename/switch, snapshots that copy an account's setup (pipelines, workflows, forms, calendars, custom fields, sites, courses) into new or existing accounts | `/agency/:orgId/*` | `/agency` |

**AI setup:** set `ANTHROPIC_API_KEY` on the API (optional `AI_ENABLED=true` to use another SDK
credential source). Without it, AI buttons are hidden and AI endpoints return 503. Requests use
Claude Opus 5.5 at low effort with server-side refusal fallback (`fallbacks: "default"`).
For development without a key, `AI_SIMULATE=true` returns canned output (ignored in production and
whenever a key is set). `AI_BOT_DELAY_MS` (default 4000) is how long the AI assistant waits after an
inbound message before replying, so a burst of messages gets one answer.

**Webhook signature:** `X-Eril-Signature: sha256=<hex HMAC-SHA256(secret, "<X-Eril-Timestamp>.<raw body>")>`.

GoHighLevel is the functional reference; see [docs/GHL_Feature_Parity.md](docs/GHL_Feature_Parity.md)
for the full feature map and what is planned for later batches. Extra env vars: `STRIPE_SECRET_KEY`,
`PAYMENTS_TEST_MODE`, `WEBHOOKS_ALLOW_PRIVATE`, `DISABLE_SCHEDULERS`, `ANTHROPIC_API_KEY`, `AI_SIMULATE`, `AI_BOT_DELAY_MS`. End-to-end
checks: `node scripts/smoke-ghl.mjs`, `node scripts/smoke-advanced.mjs` and
`node scripts/smoke-courses-agency.mjs`, `node scripts/smoke-billing.mjs`,
`node scripts/smoke-email-templates.mjs`, `node scripts/smoke-tracking.mjs`, `node scripts/smoke-ab.mjs`, `node scripts/smoke-text-to-pay.mjs` `node scripts/smoke-team-calendars.mjs` `node scripts/smoke-order-forms.mjs`, `node scripts/smoke-quantities.mjs`, `node scripts/smoke-upsells.mjs` `node scripts/smoke-communities.mjs`, `node scripts/smoke-digests.mjs`, `node scripts/smoke-mentions.mjs`, `node scripts/smoke-community-images.mjs`, `node scripts/smoke-s3-images.mjs` (fake S3 + a second API on port 3101) `node scripts/smoke-team.mjs`, `node scripts/smoke-smart-lists.mjs`, `node scripts/smoke-ai-assistant.mjs` (second API on port 3102 with simulated AI), `node scripts/smoke-branding.mjs`, `node scripts/smoke-attribution.mjs`, `node scripts/smoke-saas.mjs` (needs DB access), `node scripts/smoke-calendar-hours.mjs`, `node scripts/smoke-chat.mjs`, `node scripts/smoke-blog-qr.mjs`, `node scripts/smoke-community-files.mjs`, `node scripts/smoke-domains.mjs` (fake DNS + a second API on port 3103), `node scripts/smoke-phone.mjs` (second API on port 3104 with signed Twilio webhooks), `node scripts/smoke-messaging.mjs` (second API on port 3105), `node scripts/smoke-meta.mjs` (second API on port 3106), `node scripts/smoke-social.mjs`, `node scripts/smoke-calendar-sync.mjs` (local iCal server + a second API on port 3107), and `node scripts/smoke-downsells.mjs` (the public booking endpoint order and community posting endpoints allow 10 requests a minute per IP, so wait a minute between those runs).

**Tracking links:** set `API_PUBLIC_URL` (e.g. `https://api.yourdomain.com`) so open pixels and click
redirects in emails point at an address recipients can reach; it defaults to `http://localhost:3001`.
Community image links use the same setting, so set it in any deployment where members open the site from another machine.

**Image storage:** community images are stored in Postgres by default. For real traffic set `IMAGE_STORAGE=s3` with
`S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (and `S3_REGION`, or `S3_ENDPOINT` for Cloudflare R2,
DigitalOcean Spaces or MinIO; see `backend/.env.example`). New uploads then go to the bucket, keyed
`<prefix><workspace>/<community>/<image>.<ext>`; the bucket can stay private. Browsers still get the app's signed
image link, which checks access and then redirects to a presigned S3 URL (re-signed every 15 minutes so it caches);
`S3_SERVE=proxy` streams through the API instead. Run `cd backend && npm run images:to-s3` once to move images
already in the database (add `-- --workspace <id>` for one workspace). The server refuses to start if
`IMAGE_STORAGE=s3` is set without credentials. No AWS SDK is needed: requests are signed with a small built-in
Signature V4 client (`backend/src/storage/s3.ts`), checked against AWS's published examples.

All API routes live under `/api/v1`. Every domain table carries `workspace_id`; `TenantGuard`
resolves the active workspace (JWT claim or `x-workspace-id` header), verifies membership, and
sets permissions from the role held in *that* workspace. Services always filter by workspace.

## Quick start

Requirements: Node 20+, PostgreSQL 14+ (local install or `docker compose up -d postgres`).

```bash
npm install
cp backend/.env.example backend/.env        # set DB_PASSWORD and JWT_ACCESS_SECRET
cp frontend/.env.example frontend/.env.local
npm run build:shared
npm run migration:run
npm run seed                                 # optional demo data
npm run dev                                  # API :3001 + web :3000
```

Open http://localhost:3000. The seed creates a demo workspace; its local-only login is
documented at the top of `backend/src/database/seed.ts`.

## Workflows

Triggers: `manual`, `contact.created`, `contact.updated`, `contact.tag_added` (optional tag filter),
`opportunity.created`, `opportunity.stage_changed` (optional stage filter), `message.received`
(optional channel filter).

Actions: `send_email`, `send_sms`, `add_tag`, `remove_tag`, `update_contact`,
`create_opportunity`, `log`, and `condition` (If/Else with `equals`, `not_equals`, `contains`,
`not_contains`, `gt`, `lt`, `exists`, `not_exists`). Text fields support placeholders such as
`{{contact.firstName}}` or `{{opportunity.title}}`.

Only **published** workflows run on events; “Test run” executes any workflow on demand. Chains
of workflows triggering each other are capped at depth 3 to prevent loops.

## Email & SMS providers

`EMAIL_PROVIDER=console` (default) logs outgoing mail. Set `EMAIL_PROVIDER=sendgrid` and
`SENDGRID_API_KEY` to deliver via SendGrid. SMS likewise: `SMS_PROVIDER=twilio` with
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`. Incoming messages can be recorded
through `POST /inbox/inbound` (bridge for provider webhooks) or “Log incoming” in the UI.

## Testing

```bash
npm test                          # backend unit tests (workflow conditions)
node scripts/smoke-test.mjs       # end-to-end API checks against a running API
```

The smoke test covers auth + refresh rotation, CRM CRUD/search/filters, workflow triggers and
branches, Kanban moves and ordering, inbox send/receive/unread, dashboard totals, and tenant
isolation between two accounts.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | API (watch) + web dev servers |
| `npm run build` | Build shared, backend, frontend |
| `npm run migration:run` / `migration:revert` | Apply / roll back migrations |
| `npm run migration:generate --workspace eril-backend -- src/database/migrations/Name` | Generate a migration from entity changes |
| `npm run seed` | Demo data (idempotent) |


## Custom domains in production

Point customers' domains (CNAME, or ALIAS/ANAME for root domains) at the host in `DOMAIN_CNAME_TARGET`, and put a TLS proxy in front of the frontend that issues certificates on demand, asking the API first. With Caddy:

```
{
  on_demand_tls {
    ask https://api.example.com/api/v1/public/domains/allowed
  }
}

https:// {
  tls {
    on_demand
  }
  reverse_proxy localhost:3000
}
```

Frontend: set `APP_HOSTS` to the app's own host names (comma-separated) so they skip custom-domain routing. Backend: `DOMAIN_CNAME_TARGET` (shown in the DNS instructions), optional `RESERVED_DOMAINS` (names customers can never claim; `APP_URL`/`API_PUBLIC_URL` hosts are always reserved) and optional `DNS_SERVERS` (resolvers used for verification).
