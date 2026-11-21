// File: eril/docs/Database_Design.md
# ERIL - Database Design Document

## 1. Primary Tables

### users
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| email | VARCHAR(255) | Unique, Not Null |
| password_hash | VARCHAR(255) | Not Null |
| role | VARCHAR(50) | Not Null |
| workspace_id | UUID | FK |

### workspaces
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| name | VARCHAR(255) | Not Null |
| organization_id | UUID | FK |
| settings | JSONB | Default '{}' |

### contacts
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| first_name | VARCHAR(100) | Not Null |
| last_name | VARCHAR(100) | Not Null |
| email | VARCHAR(255) | Unique |
| phone | VARCHAR(20) |
| organization_id | UUID | FK |
| workspace_id | UUID | FK |

### opportunities
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| title | VARCHAR(255) | Not Null |
| value | DECIMAL(15,2) |
| contact_id | UUID | FK |
| pipeline_stage | VARCHAR(50) |
| workspace_id | UUID | FK |

### workflows
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| name | VARCHAR(255) | Not Null |
| trigger_type | VARCHAR(50) |
| steps | JSONB | Not Null |

## 2. Tenant Isolation
Every table (except `users` which links to workspace) will have a `workspace_id` column. The application must enforce that all queries join on `workspace_id = current_user_workspace_id`.
