// File: eril/docs/API_Specification.md
# ERIL - API Specification

## Base URL
`/api/v1`

## Endpoints

### Authentication
**POST /auth/register**
**POST /auth/login**

### CRM
**GET /crm/contacts** (Query params: search, page)
**POST /crm/contacts**
**GET /crm/contacts/:id**
**PUT /crm/contacts/:id**
**DELETE /crm/contacts/:id**

### Sales
**GET /sales/pipelines**
**GET /sales/pipelines/:id/opportunities**
**PUT /sales/opportunities/:id/stage** (Body: { stage: string })

### Automation
**GET /automation/workflows**
**POST /automation/workflows**
**PUT /automation/workflows/:id** (Body: { name, isPublished })
**POST /automation/workflows/:id/trigger** (Manually execute)
