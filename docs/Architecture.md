// File: eril/docs/Architecture.md
# ERIL - System Architecture Document

## 1. Overview
ERIL is built as a Modular Monolith. This approach separates logical domains (CRM, Sales, Automation) while keeping them in a single application for ease of deployment during the MVP phase.

## 2. Technology Stack
*   **Frontend:** Next.js 14 (React), TypeScript, Tailwind CSS.
*   **Backend:** NestJS, TypeScript, Node.js.
*   **Database:** PostgreSQL (Primary), Redis (Caching).
*   **ORM:** TypeORM.
*   **Styling:** Tailwind CSS (Design System).
*   **State Management:** React Context/Redux (Future).

## 3. Application Structure
eril/ ├── frontend/ # Next.js App │ ├── app/ # Pages (Dashboard, CRM, etc.) │ └── components/ # Reusable UI Components ├── backend/ # NestJS Application │ ├── src/ │ │ ├── auth/ # Authentication Module │ │ ├── crm/ # CRM Module │ │ ├── sales/ # Sales Module │ │ ├── automation/# Workflow Engine │ │ └── common/ # Shared utilities │ └── package.json ├── docs/ # Technical Documentation └── shared/ # Shared TypeScript Types

```
```

## 4. Data Flow
1.  **Request:** Client sends HTTP request to Backend.
2.  **Auth Middleware:** Validates JWT token and Tenant ID.
3.  **Controller:** Receives request, delegates to Service.
4.  **Service:** Performs business logic, interacts with Repository/Database.
5.  **Database:** Executes SQL query.
6.  **Response:** Service returns data, Controller serializes to JSON.
