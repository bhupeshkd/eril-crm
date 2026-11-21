# ERIL — Feature parity with GoHighLevel (reference product)

GoHighLevel (GHL) is used as the functional reference. ERIL implements equivalent
capabilities under its own design and naming. Status legend: ✅ done · 🟡 partial · ⏳ planned.

| GHL area | Capability | ERIL module | Status |
|---|---|---|---|
| Contacts | Contacts, companies, tags, search, filters | `crm` | ✅ |
| Contacts | Custom fields, notes, tasks, DND, source | `crm` | ✅ batch 1 |
| Contacts | Smart lists (saved filters), bulk actions, CSV import/export | `crm` | ✅ (saved lists with live counts, source + date-added filters, lists as campaign audiences) |
| Opportunities | Pipelines, stages, Kanban drag-and-drop, deal values | `sales` | ✅ |
| Conversations | Unified email + SMS inbox, unread, reply | `communication` | ✅ |
| Conversations | Website chat widget (embed script, visitor → contact, replies in the inbox, AI assistant can answer) | `chat` | ✅ |
| Conversations | Two-way SMS and WhatsApp via Twilio (signed webhooks, STOP/START opt-out, delivery receipts, WhatsApp 24-hour window) | `phone` | ✅ |
| Conversations | Facebook Messenger & Instagram DMs (signed Meta webhooks, verify handshake, replies via Graph Send API, 24-hour window) | `meta` | ✅ |
| Conversations | Google Business Profile chat | `communication` | ⏳ (needs a Google Business Messages partner account) |
| Calendars | Booking calendars, availability, public booking page, appointments | `calendars` | ✅ batch 1 |
| Calendars | Round-robin team calendars (round robin / balanced, cross-calendar conflicts, host reassignment, contact owner) | `calendars` | ✅ |
| Calendars | Per-member working hours & days off, appointment reminders (email/SMS) | `calendars` | ✅ |
| Calendars | Calendar sync via iCal links: private appointment feeds (out) and Google/Outlook/Apple busy times blocking bookings (in) | `calendars` | ✅ |
| Calendars | Two-way OAuth sync (create events in Google/Outlook) | `calendars` | ⏳ (needs Google/Microsoft OAuth apps) |
| Automation | Workflows with triggers, actions, If/Else | `automation` | ✅ |
| Automation | Wait/delay steps, webhooks, tasks/notes actions, form/appointment/invoice triggers | `automation` | ✅ batch 1 |
| Marketing | Email & SMS bulk campaigns to segments | `campaigns` | ✅ batch 1 |
| Marketing | Email template builder (blocks, themes, merge fields, starters, test send) | `email-templates` | ✅ |
| Marketing | Open/click tracking, campaign reports, engagement triggers, A/B subject tests | `tracking`, `campaigns` | ✅ |
| Marketing | Social planner for Facebook Pages & Instagram (drafts, scheduling, post now, per-account results) | `social` | ✅ |
| Marketing | Social planner for LinkedIn, Google Business, TikTok | `social` | ⏳ (needs provider OAuth apps) |
| Sites | Forms & surveys (hosted + embeddable) creating contacts | `forms` | ✅ batch 1 |
| Sites | Funnels & website page builder with hosted pages | `sites` | ✅ |
| Sites | Blogs (Markdown posts, drafts, scheduling, tags, RSS, SEO, views) | `sites` | ✅ |
| Marketing | Dynamic QR codes (editable destination, UTM, scan stats by day/device, SVG/PNG) | `qr` | ✅ |
| Sites | Custom domains (DNS TXT verification, host routing, on-demand TLS ask endpoint) | `sites` | ✅ |
| Memberships | Courses / membership portal with progress | `courses` | ✅ |
| Memberships | Communities: channels, posts, comments, likes, pins, moderators, bans, open join page, course auto-join, `community.*` triggers | `communities` | ✅ (file attachments ✅, points/levels/leaderboard ✅) |
| Memberships | Community images: up to 4 per post, metadata (GPS) stripped, expiring signed links; Postgres or S3-compatible storage | `communities`, `storage` | ✅ |
| Memberships | Community @mentions: autocomplete, highlights, Mentions inbox, emails with deep link and opt-out | `communities` | ✅ |
| Memberships | Community email digests (daily/weekly in the community's timezone, per-member opt-out, only unseen posts) | `communities` | ✅ |
| Payments | Products, invoices, hosted pay page (Stripe Checkout) | `payments` | ✅ batch 1 |
| Payments | Subscriptions (trials, MRR, dunning) and coupons | `payments` | ✅ |
| Payments | Order forms (one-step checkout, order bump, coupons, tax, recurring products → subscription, thank-you/redirect, `order.*` triggers) | `payments` | ✅ |
| Payments | One-click upsells after checkout (up to 3 offers, saved card via Stripe / test mode, 30-minute window, take-rate stats) | `payments` | ✅ |
| Payments | Text-to-pay: payment link by SMS/email from a conversation or contact, receipt on payment | `payments` | ✅ |
| Payments | Order quantities: optional quantity picker with a per-form maximum; flows into tax, coupons, invoices and subscription seats | `payments` | ✅ |
| Payments | Downsells: a cheaper fallback per upsell, shown only when that upsell is declined | `payments` | ✅ |
| Reputation | Review requests, review inbox, review widget | `reputation` | ✅ |
| Reporting | Dashboard KPIs, activity | `dashboard` | ✅ |
| Reporting | Lead sources, revenue, pipeline, show/win rates, forms, automation | `reports` | ✅ (ads attribution ⏳) |
| Phone | Business numbers with call forwarding, voicemail, missed-call text-back, call log, `call.missed` workflow trigger (Twilio Voice webhooks, signature-checked) | `phone` | ✅ |
| Phone | Click-to-call from contacts (rings your phone, then the customer), phone menus (IVR), recording of answered calls | `phone` | ✅ |
| Phone | In-browser softphone (WebRTC) | `phone` | ⏳ (needs a Twilio Voice SDK app) |
| AI | Content AI (drafts, reply suggestions, contact summaries, AI workflow step) | `ai` | ✅ incl. AI conversation assistant (auto-replies, hand-off to a person with a task, per-conversation pause/resume) |
| Agency | Sub-accounts console, metrics, snapshots | `agency` | ✅ (white-label branding ✅; SaaS mode ✅ — plans, trials, feature gating, contact/user limits, read-only suspension, usage rebilling ✅; custom site domains ✅; custom app domain for agencies ⏳) |
| Settings | Team, roles & permissions, API keys, webhooks | `auth`/`workspaces`/`developer` | ✅ (email invitations with 7-day links, role changes, remove/leave, at-least-one-owner rule) |
| Mobile app | Native mobile app | — | ⏳ (responsive web today) |
| Platform | Real-time notifications (SSE), live inbox refresh | `events` | ✅ |
