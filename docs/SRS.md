// File: eril/docs/SRS.md
# ERIL - Software Requirements Specification (SRS)

## 1. Introduction
**Product Name:** ERIL
**Version:** 1.0
**Purpose:** All-in-one Business Operating System for Agencies and Enterprises.

## 2. Functional Requirements

### 2.1 Authentication & Authorization
**FR-01:** Users must be able to register and login using email and password.
**FR-02:** JWT tokens must be generated for authenticated sessions.
**FR-03:** Role-Based Access Control (RBAC) must restrict module access based on user role (Admin, User, Viewer).

### 2.2 CRM Module
**FR-10:** Users must be able to create, read, update, and delete (CRUD) contacts.
**FR-11:** Contacts must be searchable by name, email, or company.
**FR-12:** Contacts must be taggable and filterable by status (Lead, Customer).

### 2.3 Sales Module
**FR-20:** Users must be able to manage Sales Pipelines.
**FR-21:** Users must be able to drag-and-drop Opportunities between Pipeline Stages.

### 2.4 Automation Module
**FR-30:** Users must be able to create visual Workflows using Triggers and Actions.
**FR-31:** Workflows must execute automatically based on configured Triggers.
**FR-32:** Workflows must support conditional logic (If/Else).

### 2.5 Communication Module
**FR-40:** Users must be able to view a Unified Inbox for Email and SMS.
**FR-41:** Users must be able to send emails via an integrated provider (e.g., SendGrid).

## 3. Non-Functional Requirements

### 3.1 Performance
**NFR-01:** The application must load within 2 seconds on a standard 4G connection.

### 3.2 Security
**NFR-02:** All data must be encrypted at rest.
**NFR-03:** Multi-Tenancy must be strictly enforced (Tenant A cannot access Tenant B's data).

### 3.3 Scalability
**NFR-04:** The system must support at least 1000 concurrent users.

### 3.4 Usability
**NFR-05:** The UI must be responsive and accessible (WCAG 2.1 AA).
