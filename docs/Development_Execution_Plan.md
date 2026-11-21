# ERIL - Development Execution Plan

## Phase 1: Foundation (Weeks 1-2)
- [x] Setup Repo Structure (Frontend/Backend).
- [x] Install dependencies (Next.js, NestJS, TypeORM, Postgres).
- [x] Configure Database Connection & Entities.
- [x] Implement Auth Service (JWT, Register, Login).
- [x] Implement RBAC Middleware.

## Phase 2: CRM (Weeks 3-4)
- [x] Contact CRUD API.
- [x] Company CRUD API.
- [x] Contact Search & Filtering.
- [x] Frontend Contact List & Detail View.

## Phase 3: Sales (Weeks 5-6)
- [x] Pipeline & Stage Management.
- [x] Opportunity CRUD.
- [x] Kanban Board Frontend (Drag and Drop).

## Phase 4: Automation (Weeks 7-9)
- [x] Workflow Entity & Storage.
- [x] Backend Workflow Engine (Event Bus).
- [x] Frontend Workflow Builder.

## Phase 5: Communication (Weeks 10-11)
- [x] Unified Inbox Frontend.
- [x] Email Service Integration (SendGrid; Twilio for SMS).

## Phase 6: Testing & Launch (Week 12)
- [x] Integration Testing (`scripts/smoke-test.mjs`, unit tests).
- [x] Bug Fixes.
- [ ] Beta Release (deployment target, real SendGrid/Twilio keys, inbound webhooks).
