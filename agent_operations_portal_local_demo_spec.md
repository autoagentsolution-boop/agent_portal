# SPEC CHI TIẾT — Local Demo Agent Operations Portal Powered by Self-hosted n8n

**Mục tiêu tài liệu:**  
Tài liệu này dùng để đưa cho Claude/Codex/AI coding agent hoặc engineer đọc, phân tích, brainstorm và triển khai bản demo local cho sản phẩm **Agent Operations Portal**.

**Phạm vi:**  
Bản này tập trung vào **local self-host demo**, không phải production SaaS. Mục tiêu là chứng minh mô hình sản phẩm hoạt động tốt theo luồng:

```text
Frontend → Backend Control Plane → n8n Workflow → Backend Callback → Frontend Result/Monitoring
```

---

## 1. Tóm tắt sản phẩm

Khách hàng muốn xây dựng một frontend portal cho phép end user setup, vận hành và theo dõi nhiều AI agents/automation agents.

Tuy nhiên, đây **không phải** là hệ thống để end user tự tạo agent tuỳ ý như một AI builder tự do.

Sản phẩm đúng nên được hiểu là:

> **Agent Operations Portal** — một portal cho phép user tạo và quản lý các Agent Instance từ những Agent Template đã được development team định nghĩa sẵn. Mỗi template được mapping với một n8n workflow cụ thể. User chỉ được cấu hình các field an toàn, chọn những integration được template cho phép, kích hoạt agent, chạy thử, theo dõi execution, output, lỗi, hiệu năng và chi phí ước tính.

---

## 2. Product positioning

### 2.1 Đây là gì?

```text
A controlled agent operation portal powered by predefined n8n workflow templates.
```

Hệ thống cho phép:

- User chọn agent template có sẵn.
- User tạo agent instance từ template.
- User chọn integration được template cho phép.
- User cấu hình tham số an toàn.
- Backend validate cấu hình.
- Backend gọi n8n workflow thông qua webhook/proxy.
- n8n chạy workflow.
- n8n callback kết quả về backend.
- Frontend hiển thị execution log, output, notification, analytics.

### 2.2 Đây không phải là gì?

Hệ thống **không phải**:

- Một free-form AI agent builder.
- Một clone của n8n workflow editor.
- Một workflow marketplace hoàn chỉnh ở demo phase.
- Một SaaS production-ready ngay từ bản đầu.
- Một hệ thống cho phép end user chỉnh sửa trực tiếp workflow logic.
- Một hệ thống cho phép user tự thêm tool/integration bất kỳ ngoài template.

### 2.3 Boundary quan trọng

User chỉ được thao tác trong giới hạn:

```text
Agent Template do dev định nghĩa sẵn
→ User tạo Agent Instance
→ User chọn integration được phép
→ User nhập config được phép
→ User run/test/activate
→ User theo dõi kết quả
```

User **không được**:

```text
- Sửa n8n workflow logic
- Thêm arbitrary step
- Thêm arbitrary integration ngoài template
- Sửa system prompt lõi nếu template không cho phép
- Bypass approval mode
- Gọi trực tiếp n8n webhook URL từ frontend
```

---

## 3. Mục tiêu demo local

Bản demo local cần chứng minh được các điểm sau:

1. Frontend có thể hiển thị danh sách Agent Templates từ backend.
2. User có thể tạo My Agent / Agent Instance từ template.
3. User chỉ có thể chọn integration được template cho phép.
4. User nhập config theo schema của template.
5. Backend validate toàn bộ template/config/integration/trigger mode.
6. Backend trigger n8n workflow thông qua webhook proxy.
7. n8n workflow chạy thật ở môi trường local self-host.
8. n8n trả kết quả hoặc callback về backend.
9. Backend lưu execution log, output, metric, error.
10. Frontend hiển thị execution history, execution detail, output, notification.
11. Dashboard/Analytics hiển thị success rate, duration, execution count, cost estimate.
12. Có thể chạy speed test 10/50/100 executions để kiểm tra tốc độ local.

---

## 4. Demo success criteria

Demo được xem là thành công khi:

```text
1. docker compose up chạy được frontend, backend, postgres và n8n.
2. User mở được frontend local.
3. User xem được Agent Templates từ backend, không phải static mock.
4. User tạo được Agent Instance từ template.
5. User không thể chọn integration không được phép.
6. User không thể tạo agent nếu thiếu required config.
7. User bấm Run Now và backend tạo execution record.
8. Backend gọi đúng n8n webhook.
9. n8n workflow xử lý và callback kết quả về backend.
10. Backend update execution status thành success/warning/failed.
11. Frontend hiển thị kết quả execution.
12. Failed execution tạo notification.
13. Retry tạo một execution mới.
14. Analytics cập nhật sau mỗi execution.
15. Speed test chạy được tối thiểu 50 executions.
16. README hướng dẫn setup rõ ràng.
17. Có demo script để trình bày với khách hàng.
```

---

## 5. Scope demo

## 5.1 In scope

Bản demo local bao gồm:

- Frontend portal dùng UI hiện tại làm nền.
- Backend API control plane.
- PostgreSQL database.
- Self-hosted n8n local bằng Docker.
- Docker Compose setup.
- Agent Template Registry.
- Agent Instance Management.
- Integration Registry với mock connection state.
- Backend-to-n8n webhook proxy.
- n8n-to-backend callback endpoint.
- Execution History.
- Execution Detail.
- Output display.
- Notifications.
- Basic Analytics.
- Retry failed execution.
- Pause/resume agent.
- 5 demo templates.
- Mock integrations.
- Optional 1–2 real-ish integrations nếu còn thời gian.
- Speed test script.
- README + demo script.

## 5.2 Out of scope

Không làm trong bản demo local:

- Full production SaaS.
- Billing/subscription.
- Multi-tenant enterprise security hoàn chỉnh.
- Full OAuth approval flow cho nhiều khách hàng.
- Production credential vault.
- Advanced RBAC.
- Custom n8n node.
- Marketplace template builder.
- End-user n8n workflow editor.
- n8n commercial license decision.
- High availability.
- Load balancing production.
- Production queue architecture.
- Real customer data.
- SOC2/GDPR/compliance layer.
- Advanced audit/compliance reporting.

---

## 6. Kiến trúc tổng thể

## 6.1 High-level architecture

```text
┌─────────────────────────────────────────────┐
│                 Frontend Portal              │
│ Dashboard / Agents / Integrations / Analytics│
│ Notifications / Execution Detail             │
└──────────────────────┬──────────────────────┘
                       │ REST API
                       ▼
┌─────────────────────────────────────────────┐
│              Backend Control Plane           │
│ Auth mock / Template Registry / Agent CRUD   │
│ Integration Rules / n8n Proxy / Callback     │
│ Execution Logs / Metrics / Notifications     │
└───────────────┬─────────────────┬───────────┘
                │                 │
                ▼                 ▼
┌───────────────────────┐   ┌───────────────────────┐
│      PostgreSQL        │   │     Self-hosted n8n    │
│ Templates / Agents     │   │ Webhook Workflows      │
│ Executions / Outputs   │   │ Schedule Workflows     │
│ Notifications / Audit  │   │ Mock/AI Integrations   │
└───────────────────────┘   └───────────────────────┘
                ▲                 │
                │ Callback result │
                └─────────────────┘
```

## 6.2 Nguyên tắc kiến trúc

### Rule 1 — Frontend không gọi n8n trực tiếp

Không làm:

```text
Frontend → n8n webhook
```

Làm đúng:

```text
Frontend → Backend → n8n webhook
```

Lý do:

- Không lộ n8n webhook URL.
- Backend kiểm soát auth/permission.
- Backend validate template/config.
- Backend lưu execution trước khi trigger.
- Backend log/audit toàn bộ action.
- Backend tính cost, duration, status.
- Backend kiểm soát retry/rate limit.

### Rule 2 — Backend là control plane

Backend chịu trách nhiệm:

- Quản lý user/workspace demo.
- Quản lý Agent Template.
- Quản lý Agent Instance.
- Validate selected integrations.
- Validate config schema.
- Validate trigger mode.
- Trigger n8n.
- Nhận callback.
- Lưu execution.
- Lưu output.
- Tạo notification.
- Tính analytics.

### Rule 3 — n8n là execution engine

n8n chịu trách nhiệm:

- Nhận payload từ backend.
- Chạy workflow.
- Gọi AI/model/mock logic nếu cần.
- Gọi integration/mock integration nếu cần.
- Chuẩn hoá output theo contract.
- Callback backend.

### Rule 4 — Template kiểm soát quyền user

Agent Template quyết định:

- User được chọn integration nào.
- Field nào được cấu hình.
- Trigger mode nào được phép.
- Có cần approval không.
- Output contract như thế nào.
- Workflow n8n nào được gọi.

---

## 7. Recommended tech stack

## 7.1 Frontend

Có thể dùng stack hiện tại. Nếu cần chuẩn hoá:

```text
React / Vite React / Next.js
TypeScript
Tailwind CSS
shadcn/ui hoặc component system hiện tại
REST API client
```

Yêu cầu frontend:

- Không hardcode data chính.
- Lấy templates/agents/integrations/executions từ backend.
- Có loading state.
- Có empty state.
- Có error state.
- Có action confirmation cho delete/archive.
- Có status chip rõ ràng.

## 7.2 Backend

Đề xuất:

```text
Node.js
TypeScript
Express / Fastify / NestJS
PostgreSQL
Prisma hoặc Drizzle ORM
Zod validation
Axios/fetch để gọi n8n webhook
```

Backend local cần đơn giản nhưng có cấu trúc rõ:

```text
src/
  modules/
    templates/
    agents/
    integrations/
    executions/
    notifications/
    analytics/
    n8n/
  db/
  seeds/
  utils/
```

## 7.3 Database

```text
PostgreSQL local Docker container
```

## 7.4 n8n

```text
Self-hosted n8n Docker container
```

n8n cần:

- Import được workflow JSON.
- Có webhook workflow.
- Có callback node gọi backend.
- Có mock workflow cho demo.

## 7.5 Optional Redis

Không bắt buộc cho demo. Chỉ thêm nếu muốn test queue/local concurrency.

---

## 8. Local Docker Compose structure

Mục tiêu: chạy toàn bộ stack bằng một command.

```bash
docker compose up --build
```

Các service tối thiểu:

```text
frontend
backend
postgres
n8n
```

Optional:

```text
redis
```

Expected local URLs:

```text
Frontend: http://localhost:3000 hoặc http://localhost:5173
Backend:  http://localhost:4000
n8n:      http://localhost:5678
Postgres: localhost:5432
```

`.env.example` nên có:

```env
NODE_ENV=development
BACKEND_PORT=4000
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/agent_portal
N8N_BASE_URL=http://n8n:5678
N8N_WEBHOOK_BASE_URL=http://n8n:5678/webhook
N8N_CALLBACK_SECRET=local-demo-secret
FRONTEND_URL=http://localhost:3000
```

---

## 9. Core entities

## 9.1 Workspace

Demo có thể chỉ cần một workspace mặc định.

```json
{
  "id": "workspace_demo",
  "name": "Demo Workspace"
}
```

## 9.2 User

Demo có thể dùng local admin mock.

```json
{
  "id": "user_demo_admin",
  "workspace_id": "workspace_demo",
  "name": "Demo Admin",
  "email": "admin@example.local",
  "role": "admin"
}
```

## 9.3 Agent Template

Agent Template là blueprint do dev định nghĩa.

Template bao gồm:

- ID.
- Name.
- Category.
- Description.
- Task scope.
- Limitations.
- Required integrations.
- Optional integrations.
- Allowed trigger modes.
- Config schema.
- n8n webhook path.
- Approval requirement.
- Cost level.
- Output contract.
- Status.

Example:

```json
{
  "id": "gmail_lead_classifier",
  "name": "Gmail Lead Classifier",
  "category": "Sales",
  "description": "Classify inbound lead emails and assign lead score.",
  "task_scope": "Classifies lead emails into hot, warm, cold, not relevant.",
  "limitations": [
    "Does not send emails automatically.",
    "Does not update CRM records in demo mode."
  ],
  "required_integrations": ["gmail"],
  "optional_integrations": ["slack", "google_sheet"],
  "allowed_trigger_modes": ["manual", "schedule"],
  "config_schema": {
    "gmail_label": {
      "type": "string",
      "label": "Gmail Label",
      "required": true,
      "default": "Leads"
    },
    "lead_score_threshold": {
      "type": "number",
      "label": "Lead Score Threshold",
      "required": true,
      "default": 70,
      "min": 0,
      "max": 100
    },
    "notify_slack": {
      "type": "boolean",
      "label": "Notify Slack",
      "required": false,
      "default": false
    }
  },
  "n8n_webhook_path": "/webhook/gmail-lead-classifier",
  "approval_required": false,
  "cost_level": "low",
  "status": "active"
}
```

## 9.4 Agent Instance

Agent Instance là agent user tạo từ template.

```json
{
  "id": "agent_001",
  "workspace_id": "workspace_demo",
  "template_id": "gmail_lead_classifier",
  "name": "Sales Lead Classifier",
  "status": "running",
  "trigger_mode": "manual",
  "selected_integrations": ["gmail", "slack"],
  "config": {
    "gmail_label": "Inbound Leads",
    "lead_score_threshold": 75,
    "notify_slack": true
  },
  "created_by": "user_demo_admin"
}
```

Agent statuses:

```text
draft
running
paused
error
archived
```

## 9.5 Integration

Integration có thể là mock hoặc real-ish trong demo.

```json
{
  "id": "gmail",
  "workspace_id": "workspace_demo",
  "integration_key": "gmail",
  "name": "Gmail",
  "category": "Communication",
  "status": "mock_connected",
  "mock_enabled": true,
  "used_by_agent_count": 2,
  "last_tested_at": "2026-05-04T10:00:00Z"
}
```

Integration statuses:

```text
not_connected
connected
mock_connected
error
expired
```

## 9.6 Execution

Execution là một lần agent chạy.

```json
{
  "id": "exec_001",
  "workspace_id": "workspace_demo",
  "agent_instance_id": "agent_001",
  "template_id": "gmail_lead_classifier",
  "status": "success",
  "trigger_type": "manual",
  "started_at": "2026-05-04T10:00:00Z",
  "finished_at": "2026-05-04T10:00:08Z",
  "duration_ms": 8000,
  "input_count": 10,
  "output_count": 10,
  "error_count": 0,
  "tokens_input": 5000,
  "tokens_output": 800,
  "estimated_cost_usd": 0.01,
  "n8n_execution_id": "n8n_exec_abc",
  "result_summary": "10 emails classified. 3 hot leads found.",
  "error_message": null
}
```

Execution statuses:

```text
queued
running
success
warning
failed
cancelled
```

## 9.7 Execution Output

Lưu full output JSON riêng để tránh executions table quá nặng.

```json
{
  "id": "output_001",
  "execution_id": "exec_001",
  "output_json": {
    "summary": "10 emails classified. 3 hot leads found.",
    "data": []
  }
}
```

## 9.8 Notification

Notification được tạo từ execution event.

```json
{
  "id": "notif_001",
  "workspace_id": "workspace_demo",
  "agent_instance_id": "agent_001",
  "execution_id": "exec_001",
  "severity": "warning",
  "type": "rate_limit_warning",
  "title": "Rate Limit Warning",
  "message": "The workflow is approaching the mock provider limit.",
  "status": "unread"
}
```

Notification severity:

```text
critical
warning
info
success
```

Notification status:

```text
unread
acknowledged
resolved
```

## 9.9 Audit Log

Audit log cho demo có thể đơn giản.

Events cần log:

- Agent created.
- Agent updated.
- Agent paused.
- Agent resumed.
- Agent run manually.
- Execution completed.
- Execution failed.
- Notification resolved.

---

## 10. Database schema draft

Tables:

```text
workspaces
users
agent_templates
agent_instances
integrations
agent_instance_integrations
executions
execution_outputs
notifications
audit_logs
```

## 10.1 workspaces

```text
id                     text primary key
name                   text not null
created_at             timestamp
updated_at             timestamp
```

## 10.2 users

```text
id                     text primary key
workspace_id            text references workspaces(id)
name                   text not null
email                  text not null
role                   text not null
created_at             timestamp
updated_at             timestamp
```

## 10.3 agent_templates

```text
id                             text primary key
name                           text not null
category                       text not null
description                    text
task_scope                     text
limitations_json               jsonb
required_integrations_json     jsonb
optional_integrations_json     jsonb
allowed_trigger_modes_json     jsonb
config_schema_json             jsonb
output_contract_json           jsonb
n8n_webhook_path               text not null
approval_required              boolean default false
cost_level                     text
status                         text
created_at                     timestamp
updated_at                     timestamp
```

## 10.4 agent_instances

```text
id                     text primary key
workspace_id            text references workspaces(id)
template_id             text references agent_templates(id)
name                   text not null
status                 text not null
trigger_mode            text not null
config_json             jsonb
created_by              text references users(id)
created_at              timestamp
updated_at              timestamp
```

## 10.5 integrations

```text
id                     text primary key
workspace_id            text references workspaces(id)
integration_key         text not null
name                   text not null
category               text
status                 text not null
mock_enabled            boolean default true
last_tested_at          timestamp
metadata_json           jsonb
created_at              timestamp
updated_at              timestamp
```

## 10.6 agent_instance_integrations

```text
id                     text primary key
agent_instance_id       text references agent_instances(id)
integration_id          text references integrations(id)
created_at              timestamp
```

## 10.7 executions

```text
id                     text primary key
workspace_id            text references workspaces(id)
agent_instance_id       text references agent_instances(id)
template_id             text references agent_templates(id)
status                 text not null
trigger_type            text not null
started_at              timestamp
finished_at             timestamp
duration_ms             integer
input_count             integer default 0
output_count            integer default 0
error_count             integer default 0
tokens_input            integer default 0
tokens_output           integer default 0
estimated_cost_usd      numeric default 0
n8n_execution_id         text
result_summary          text
error_message           text
created_at              timestamp
updated_at              timestamp
```

## 10.8 execution_outputs

```text
id                     text primary key
execution_id            text references executions(id)
output_json             jsonb
created_at              timestamp
```

## 10.9 notifications

```text
id                     text primary key
workspace_id            text references workspaces(id)
agent_instance_id       text references agent_instances(id)
execution_id            text references executions(id)
severity                text not null
type                   text not null
title                  text not null
message                text
status                 text not null
created_at              timestamp
updated_at              timestamp
```

## 10.10 audit_logs

```text
id                     text primary key
workspace_id            text references workspaces(id)
actor_user_id           text references users(id)
entity_type             text not null
entity_id               text not null
action                 text not null
before_json             jsonb
after_json              jsonb
created_at              timestamp
```

---

## 11. Backend API spec

Base URL:

```text
http://localhost:4000/api
```

## 11.1 Agent Templates

### Get all templates

```http
GET /api/agent-templates
```

Response:

```json
{
  "data": [
    {
      "id": "gmail_lead_classifier",
      "name": "Gmail Lead Classifier",
      "category": "Sales",
      "description": "Classify inbound lead emails and assign lead score.",
      "required_integrations": ["gmail"],
      "optional_integrations": ["slack", "google_sheet"],
      "allowed_trigger_modes": ["manual", "schedule"],
      "approval_required": false,
      "cost_level": "low",
      "status": "active"
    }
  ]
}
```

### Get template detail

```http
GET /api/agent-templates/:id
```

Response includes full config schema and output contract.

---

## 11.2 Agent Instances

### Get all agent instances

```http
GET /api/agent-instances
```

Optional query:

```text
?status=running&template_id=gmail_lead_classifier
```

### Get agent instance detail

```http
GET /api/agent-instances/:id
```

### Create agent instance

```http
POST /api/agent-instances
```

Request:

```json
{
  "template_id": "gmail_lead_classifier",
  "name": "Sales Lead Classifier",
  "selected_integrations": ["gmail", "slack"],
  "trigger_mode": "manual",
  "config": {
    "gmail_label": "Inbound Leads",
    "lead_score_threshold": 75,
    "notify_slack": true
  }
}
```

Backend validation:

```text
1. template_id must exist.
2. template status must be active.
3. selected_integrations must include required_integrations.
4. selected_integrations must be subset of required + optional integrations.
5. selected integrations must exist in workspace integration registry.
6. trigger_mode must be in allowed_trigger_modes.
7. config must match config_schema.
8. required config fields must not be empty.
9. number fields must respect min/max if defined.
```

### Update agent instance

```http
PATCH /api/agent-instances/:id
```

Only allow safe fields:

```text
name
config
trigger_mode
selected_integrations
```

Do not allow user to update:

```text
template_id
n8n_webhook_path
core workflow mapping
output contract
```

### Update agent status

```http
PATCH /api/agent-instances/:id/status
```

Request:

```json
{
  "status": "paused"
}
```

Allowed transitions for demo:

```text
draft → running
running → paused
paused → running
running → error
error → paused
error → running
running → archived
paused → archived
```

### Delete/archive agent

```http
DELETE /api/agent-instances/:id
```

For demo, this should archive instead of hard delete.

---

## 11.3 Run Agent

### Run agent manually

```http
POST /api/agent-instances/:id/run
```

Request:

```json
{
  "mode": "test",
  "input_override": null
}
```

Response:

```json
{
  "execution_id": "exec_001",
  "status": "running",
  "message": "Execution started."
}
```

Backend behavior:

```text
1. Load agent instance.
2. Check agent status.
3. Load template.
4. Validate selected integrations against template.
5. Create execution record with status running.
6. Build n8n payload.
7. Call n8n webhook URL.
8. If n8n returns immediately, process result.
9. If n8n uses callback, wait for callback and allow frontend polling.
10. Update execution status.
11. Store output.
12. Generate notification if warning/failed.
13. Return execution_id to frontend.
```

Error conditions:

```text
- Agent not found.
- Agent archived.
- Agent paused and run is not allowed.
- Template inactive.
- Missing required integration.
- Invalid config.
- n8n webhook timeout.
- n8n callback missing.
```

---

## 11.4 n8n Callback

### Callback endpoint

```http
POST /api/n8n/callback
```

Security for local demo:

```text
Header: x-demo-callback-secret: local-demo-secret
```

Payload success:

```json
{
  "execution_id": "exec_001",
  "agent_instance_id": "agent_001",
  "template_id": "gmail_lead_classifier",
  "status": "success",
  "n8n_execution_id": "n8n_abc",
  "started_at": "2026-05-04T10:00:00Z",
  "finished_at": "2026-05-04T10:00:08Z",
  "metrics": {
    "input_count": 10,
    "output_count": 10,
    "error_count": 0,
    "tokens_input": 5000,
    "tokens_output": 800,
    "estimated_cost_usd": 0.01
  },
  "result": {
    "summary": "10 emails classified. 3 hot leads found.",
    "data": []
  },
  "error": null
}
```

Payload failed:

```json
{
  "execution_id": "exec_001",
  "agent_instance_id": "agent_001",
  "template_id": "ticket_triage_agent",
  "status": "failed",
  "n8n_execution_id": "n8n_error_abc",
  "started_at": "2026-05-04T10:00:00Z",
  "finished_at": "2026-05-04T10:00:05Z",
  "metrics": {
    "input_count": 5,
    "output_count": 0,
    "error_count": 1,
    "tokens_input": 0,
    "tokens_output": 0,
    "estimated_cost_usd": 0
  },
  "result": null,
  "error": {
    "code": "MOCK_PROVIDER_TIMEOUT",
    "message": "Mock provider timed out.",
    "retryable": true
  }
}
```

Backend callback behavior:

```text
1. Validate callback secret.
2. Find execution by execution_id.
3. Update execution status.
4. Store metrics.
5. Store output_json if result exists.
6. Store error_message if failed.
7. Generate notification:
   - failed → critical/warning notification
   - warning → warning notification
   - success → optional success notification
8. Write audit log.
```

---

## 11.5 Executions

### List executions

```http
GET /api/executions
```

Query examples:

```text
?agent_instance_id=agent_001
?status=failed
?limit=50
```

### Get execution detail

```http
GET /api/executions/:id
```

Response should include:

- Execution summary.
- Output JSON.
- Related agent.
- Related template.
- Related notifications.

### Retry execution

```http
POST /api/executions/:id/retry
```

Behavior:

```text
1. Load old execution.
2. Load related agent.
3. Create new execution.
4. Trigger same agent again.
5. Link retry_from_execution_id if field exists.
```

---

## 11.6 Integrations

### List integrations

```http
GET /api/integrations
```

### Mock connect integration

```http
POST /api/integrations/:id/mock-connect
```

### Test integration

```http
POST /api/integrations/:id/test
```

Response:

```json
{
  "status": "success",
  "message": "Mock connection is healthy.",
  "tested_at": "2026-05-04T10:00:00Z"
}
```

### Disconnect integration

```http
POST /api/integrations/:id/disconnect
```

---

## 11.7 Notifications

### List notifications

```http
GET /api/notifications
```

Query:

```text
?status=unread
?severity=warning
```

### Acknowledge notification

```http
PATCH /api/notifications/:id/acknowledge
```

### Resolve notification

```http
PATCH /api/notifications/:id/resolve
```

---

## 11.8 Analytics

### Summary analytics

```http
GET /api/analytics/summary
```

Response:

```json
{
  "total_agents": 5,
  "active_agents": 3,
  "total_executions": 120,
  "success_executions": 110,
  "failed_executions": 10,
  "success_rate": 91.67,
  "avg_duration_ms": 4200,
  "p95_duration_ms": 7800,
  "total_tokens_input": 250000,
  "total_tokens_output": 40000,
  "estimated_cost_usd": 1.25,
  "latest_failures": []
}
```

### Agent analytics

```http
GET /api/analytics/agents/:id
```

---

## 12. n8n workflow contract

## 12.1 Backend to n8n request

All n8n workflows should accept this standard payload:

```json
{
  "execution_id": "exec_001",
  "agent_instance_id": "agent_001",
  "template_id": "gmail_lead_classifier",
  "workspace_id": "workspace_demo",
  "config": {
    "gmail_label": "Inbound Leads",
    "lead_score_threshold": 75
  },
  "selected_integrations": ["gmail", "slack"],
  "input": {
    "mode": "test",
    "items": []
  },
  "callback": {
    "url": "http://backend:4000/api/n8n/callback",
    "secret": "local-demo-secret"
  }
}
```

## 12.2 n8n to backend callback

All workflows must callback using this structure:

```json
{
  "execution_id": "exec_001",
  "agent_instance_id": "agent_001",
  "template_id": "gmail_lead_classifier",
  "status": "success",
  "n8n_execution_id": "n8n_abc",
  "started_at": "2026-05-04T10:00:00Z",
  "finished_at": "2026-05-04T10:00:08Z",
  "metrics": {
    "input_count": 10,
    "output_count": 10,
    "error_count": 0,
    "tokens_input": 5000,
    "tokens_output": 800,
    "estimated_cost_usd": 0.01
  },
  "result": {
    "summary": "Execution completed.",
    "data": []
  },
  "error": null
}
```

## 12.3 Standard workflow steps in n8n

Each workflow should follow this structure:

```text
1. Webhook Trigger
2. Read incoming payload
3. Validate required fields
4. Load mock data or use provided input
5. Process task logic
6. Optional AI/model call
7. Normalize output
8. Build metrics
9. Callback backend
10. Return basic response
```

## 12.4 Error handling in n8n

If workflow fails, it should still callback backend with failed status if possible.

Error format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "retryable": true
  }
}
```

Recommended error codes:

```text
INVALID_PAYLOAD
MISSING_CONFIG
MOCK_PROVIDER_TIMEOUT
AI_MODEL_TIMEOUT
INTEGRATION_ERROR
RATE_LIMIT_WARNING
UNKNOWN_WORKFLOW_ERROR
```

---

## 13. Frontend screen requirements

## 13.1 Dashboard

Purpose:

Show operational health.

Required widgets:

```text
- Total active agents
- Total executions today
- Success rate
- Failed executions
- Average duration
- Estimated cost
- Latest errors
- Recent executions
```

Acceptance:

```text
- Data comes from backend analytics API.
- Dashboard updates after running agent.
- Failed execution appears in latest errors.
```

---

## 13.2 Agents page

Agents page should have two tabs:

```text
Agent Templates
My Agents
```

### Agent Templates tab

Template card should show:

```text
- Template name
- Category
- Description
- Task scope short text
- Required integrations
- Optional integrations
- Trigger modes
- Approval requirement
- Cost level
- Create Agent button
```

CTA:

```text
Create Agent
```

### My Agents tab

Agent card should show:

```text
- Agent name
- Template name
- Status
- Trigger mode
- Integrations used
- Last run
- Next run if scheduled
- Success rate
- Executions today
- Failed runs
- Estimated cost
- Actions: Run Now, Pause/Resume, View Details, Archive
```

Acceptance:

```text
- User can switch between Templates and My Agents.
- User can create agent from template.
- User can run active agent.
- User can pause/resume agent.
```

---

## 13.3 Create Agent Wizard

Wizard steps:

```text
1. Select Template
2. Review Task Scope
3. Select Integrations
4. Configure Fields
5. Select Trigger Mode
6. Test Run
7. Activate Agent
```

### Step 1 — Select Template

Show available templates.

### Step 2 — Review Task Scope

Show:

```text
- What this agent does
- What this agent does not do
- Required integrations
- Optional integrations
- Trigger modes
- Approval mode
- Output type
- Cost level
```

### Step 3 — Select Integrations

Rules:

```text
- Show only required + optional integrations from template.
- Required integrations must be selected.
- Optional integrations can be toggled.
- Disallowed integrations must not appear.
```

### Step 4 — Configure Fields

Render dynamic form from config_schema.

Supported field types for demo:

```text
string
number
boolean
select
textarea
array (string | number items; minItems, maxItems optional)
```

### Step 5 — Select Trigger Mode

Supported:

```text
Manual
Schedule mock
```

Webhook can be displayed as disabled if not implemented.

### Step 6 — Test Run

Behavior:

```text
- Backend creates test execution.
- n8n workflow runs.
- Output preview appears.
- Failure is shown clearly.
```

### Step 7 — Activate Agent

Agent status becomes running.

Acceptance:

```text
- Cannot complete wizard with invalid config.
- Cannot select invalid integration.
- Test run creates execution.
```

---

## 13.4 Agent Detail Page

Tabs:

```text
Overview
Configuration
Executions
Outputs
Notifications
Audit Log
```

### Overview

Show:

```text
- Status
- Template
- Trigger mode
- Integrations
- Last run
- Next run
- Success rate
- Average duration
- Estimated cost
- Latest result summary
```

### Configuration

Allow editing only safe fields:

```text
- Agent name
- Config fields from config_schema
- Trigger mode if allowed
- Optional integrations
```

Do not allow editing:

```text
- Template mapping
- n8n webhook path
- Core task logic
- Output contract
```

### Executions

Show:

```text
- Execution ID
- Status
- Trigger type
- Started at
- Duration
- Input count
- Output count
- Error count
- Cost estimate
- View Detail action
```

### Outputs

Show normalized outputs.

### Notifications

Show notifications related to this agent.

### Audit Log

Show action history.

---

## 13.5 Execution Detail Page

Show:

```text
- Execution status
- Agent name
- Template name
- Trigger type
- Started at
- Finished at
- Duration
- Input payload preview
- Output payload
- Result summary
- Token estimate
- Cost estimate
- n8n execution reference
- Error details if failed
- Retry button
```

Acceptance:

```text
- Every execution can be opened.
- Failed execution clearly shows reason.
- Retry creates a new execution.
```

---

## 13.6 Integrations Page

Use current catalog layout but add operational states.

Each card should show:

```text
- Name
- Category
- Description
- Status: Connected / Mock Connected / Error / Not Connected
- Used by agent count
- Last tested at
- Actions: Mock Connect, Test Connection, Disconnect, View Agents
```

Filters:

```text
All
Connected
Mock Connected
Error
Not Connected
Required by Active Agents
```

Acceptance:

```text
- Integration state comes from backend.
- User can mock-connect integration.
- User can test integration.
- Create Agent Wizard respects allowed integrations.
```

---

## 13.7 Notifications Page

Filters:

```text
All
Unread
Critical
Warning
Error
Success
Info
Resolved
```

Each notification should show:

```text
- Icon/severity
- Title
- Message
- Agent name
- Execution reference
- Time
- Status
- Actions: View Execution, Retry, Mark Resolved, Open Agent
```

Acceptance:

```text
- Failed execution creates notification.
- Warning execution creates notification.
- User can mark resolved.
- User can open execution detail from notification.
```

---

## 13.8 Analytics Page

Metrics:

```text
- Total executions
- Success executions
- Failed executions
- Success rate
- Average duration
- p50 duration
- p95 duration
- Total input count
- Total output count
- Estimated token usage
- Estimated cost
- Top agents by execution count
- Latest failures
```

Acceptance:

```text
- Analytics reflects executions table.
- Running speed test updates analytics.
- User can filter by agent if possible.
```

---

## 14. Demo Agent Templates

Build 5 templates.

## 14.1 Gmail Lead Classifier

Purpose:

```text
Classify inbound lead emails and assign lead score.
```

Required integration:

```text
Gmail mock
```

Optional integrations:

```text
Slack mock
Google Sheet mock
```

Input:

```json
{
  "emails": [
    {
      "subject": "Need automation solution",
      "body": "We need help automating our sales process and want pricing."
    }
  ]
}
```

Output:

```json
{
  "items_processed": 1,
  "classifications": [
    {
      "lead_type": "hot_lead",
      "score": 88,
      "reason": "Customer asked for pricing and implementation support.",
      "recommended_action": "Create reply draft"
    }
  ],
  "summary": "1 hot lead found."
}
```

---

## 14.2 Email Draft Responder

Purpose:

```text
Generate email draft replies.
```

Required integration:

```text
Gmail mock
```

Optional integration:

```text
Slack mock
```

Important rule:

```text
For demo, do not send emails automatically.
Only create draft output with approval_status = waiting_for_review.
```

Output:

```json
{
  "items_processed": 1,
  "drafts": [
    {
      "subject": "Re: Automation solution request",
      "body": "Thank you for reaching out...",
      "approval_status": "waiting_for_review"
    }
  ],
  "summary": "1 draft created and waiting for approval."
}
```

---

## 14.3 Slack Daily Summary

Purpose:

```text
Summarize Slack messages and create action items.
```

Required integration:

```text
Slack mock
```

Output:

```json
{
  "items_processed": 20,
  "summary": "The team discussed API issues and pending client review.",
  "risks": [
    "API delay may affect delivery date."
  ],
  "action_items": [
    {
      "owner": "Engineering",
      "task": "Check API timeout issue",
      "priority": "high"
    }
  ]
}
```

---

## 14.4 Google Sheet Data Checker

Purpose:

```text
Validate rows from a sheet-like data source.
```

Required integration:

```text
Google Sheet mock
```

Output:

```json
{
  "rows_checked": 100,
  "invalid_rows": 7,
  "issues": [
    {
      "row": 12,
      "field": "email",
      "issue": "missing email"
    }
  ],
  "summary": "100 rows checked. 7 invalid rows found."
}
```

---

## 14.5 Ticket Triage Agent

Purpose:

```text
Classify support tickets by priority, sentiment and category.
```

Required integration:

```text
Helpdesk mock
```

Optional integration:

```text
Slack mock
```

Output:

```json
{
  "items_processed": 5,
  "tickets": [
    {
      "ticket_id": "TCK-001",
      "priority": "high",
      "sentiment": "negative",
      "category": "billing_issue",
      "assigned_team": "support_l2"
    }
  ],
  "summary": "5 tickets triaged. 1 high-priority ticket found."
}
```

---

## 15. Speed test requirement

Create a local script:

```bash
npm run speed-test -- --template gmail_lead_classifier --count 100
```

Supported counts:

```text
10
50
100
```

Metrics to collect:

```text
- Total executions
- Success count
- Failed count
- Average duration
- p50 duration
- p95 duration
- Callback missing count
- Database write errors
- Average backend response time
- Average n8n execution time
```

Output JSON:

```json
{
  "test_name": "100 execution local test",
  "template_id": "gmail_lead_classifier",
  "total_executions": 100,
  "success_count": 98,
  "failed_count": 2,
  "avg_duration_ms": 4200,
  "p50_duration_ms": 3900,
  "p95_duration_ms": 7800,
  "callback_missing_count": 0,
  "database_write_errors": 0,
  "notes": "2 failures were simulated provider timeout."
}
```

Analytics page should be able to show latest speed test summary if implemented.

---

## 16. Cost and effort estimate

## 16.1 Recommended demo target

```text
Timeline: 4 weeks
Engineer: 1 full-time
AI support: Claude/Codex
Templates: 5
Mode: local self-host n8n
Real integrations: max 1–2 optional
Core proof: frontend → backend → n8n → backend → frontend
```

## 16.2 Cash cost

```text
n8n local:              $0
Postgres local:         $0
Docker local:           $0
Frontend/backend local: $0
AI coding tools:        $20–$300
LLM API testing:        $50–$300
Misc/ngrok/log tool:    $0–$50
```

Estimated cash cost:

```text
$70–$650
~1.8M–17M VND
```

## 16.3 Engineering cost

Depending on rate:

```text
Low:    $3,000–$5,000
Normal: $5,000–$9,000
High:   $9,000–$15,000
```

Recommended planning number:

```text
$5,200–$9,600 total demo cost
~135M–250M VND
```

---

## 17. Four-week implementation plan

## Week 1 — Foundation

Goals:

```text
- Local Docker Compose
- Backend base
- Database schema
- Seed templates
- First n8n workflow
- End-to-end first run
```

Tasks:

```text
Day 1:
- Setup repo structure.
- Setup Docker Compose.
- Setup frontend/backend/postgres/n8n services.
- Create .env.example.

Day 2:
- Create database schema.
- Add ORM.
- Seed workspace/user/integrations/templates.

Day 3:
- Implement template APIs.
- Implement agent instance APIs.
- Implement config validation.

Day 4:
- Implement n8n webhook proxy.
- Implement callback endpoint.
- Create first n8n workflow.

Day 5:
- Connect frontend Templates/My Agents to backend.
- Run first end-to-end test.
```

Deliverable:

```text
User can create one agent and run one workflow end-to-end.
```

---

## Week 2 — Frontend connected flow

Goals:

```text
- Create Agent Wizard
- Integration mock state
- Execution History
- Execution Detail
- 3 total templates
```

Tasks:

```text
Day 6:
- Build Create Agent Wizard step 1–3.

Day 7:
- Build config_schema dynamic form.
- Validate required fields.

Day 8:
- Integrations page connects to backend.
- Mock connect/test/disconnect.

Day 9:
- Add Email Draft Responder workflow.
- Add Slack Daily Summary workflow.

Day 10:
- Build Execution History and Detail pages.
```

Deliverable:

```text
User can create and run multiple agent templates and view execution detail.
```

---

## Week 3 — Operations layer

Goals:

```text
- Notifications
- Analytics
- Retry
- Error simulation
- 5 total templates
- Speed test script
```

Tasks:

```text
Day 11:
- Implement notification generation.
- Connect Notifications page.

Day 12:
- Implement analytics summary API.
- Connect Analytics page.

Day 13:
- Add Google Sheet Data Checker workflow.

Day 14:
- Add Ticket Triage Agent workflow.
- Add simulated failure mode.

Day 15:
- Implement retry endpoint.
- Implement speed test script.
```

Deliverable:

```text
Demo has operations dashboard, notifications, analytics and speed test.
```

---

## Week 4 — Polish and demo package

Goals:

```text
- UI polish
- Loading/empty/error states
- README
- Demo script
- Speed test report
- Final walkthrough
```

Tasks:

```text
Day 16:
- Polish UI states.
- Fix empty/loading/error states.

Day 17:
- Improve execution detail.
- Improve notification actions.

Day 18:
- Prepare demo data.
- Prepare demo script.

Day 19:
- Run clean setup test.
- Run speed tests.
- Fix bugs.

Day 20:
- Write README.
- Export n8n workflows.
- Prepare final technical summary.
```

Deliverable:

```text
Stable local demo ready for customer presentation.
```

---

## 18. AI coding workflow for 1 engineer

Recommended workflow:

```text
1. Engineer owns architecture and reviews all changes.
2. Claude/Codex implements small modules only.
3. Never ask AI to build the whole system in one prompt.
4. Keep schema/API contract fixed.
5. Commit after each working module.
6. Run local tests after every meaningful change.
```

Suggested AI roles:

```text
AI Agent 1: Backend module implementation
AI Agent 2: Frontend UI/API integration
AI Agent 3: n8n workflow JSON/spec generation
AI Agent 4: QA/test/debug reviewer
```

Prompting rule:

```text
One prompt = one module = one clear acceptance criteria.
```

Bad prompt:

```text
Build the whole app.
```

Good prompt:

```text
Implement backend API for Agent Templates and Agent Instances using the existing schema. Do not touch frontend. Add validation so selected integrations must be allowed by the template. Add tests or a simple local verification script.
```

---

## 19. Main risks and mitigations

## Risk 1 — Scope creep

Problem:

```text
Demo becomes full agent builder or n8n clone.
```

Mitigation:

```text
Keep strict template-controlled model.
User cannot edit workflow logic.
```

## Risk 2 — Inconsistent n8n outputs

Problem:

```text
Each workflow returns different JSON structure.
```

Mitigation:

```text
Use one callback contract for all workflows.
Backend rejects invalid callback shape.
```

## Risk 3 — Frontend looks good but platform loop is fake

Problem:

```text
UI remains static and does not prove product works.
```

Mitigation:

```text
Prioritize end-to-end execution over visual polish.
```

## Risk 4 — Too many integrations too early

Problem:

```text
Real OAuth/integration takes too much time.
```

Mitigation:

```text
Use mock integrations first.
Add only 1–2 real-ish integrations if time allows.
```

## Risk 5 — AI coding creates inconsistent architecture

Problem:

```text
Claude/Codex may generate duplicate models, inconsistent API, or break existing UI.
```

Mitigation:

```text
Use small prompts.
Review diff.
Keep source of truth spec.
Do not allow broad refactor without approval.
```

## Risk 6 — n8n license concern later

Problem:

```text
Local demo is fine, but commercial SaaS may require n8n commercial agreement.
```

Mitigation:

```text
Do not promise production licensing in demo.
Flag n8n commercial licensing as next-phase legal/commercial check.
```

---

## 20. Questions for Claude/technical reviewer

Ask Claude or another reviewer to challenge:

```text
1. Is backend control-plane architecture correct?
2. Should frontend ever call n8n directly in local demo?
3. Is the database model too large or just enough?
4. Which API endpoints are missing?
5. Is callback contract sufficient for all 5 templates?
6. Should execution be sync or async for demo?
7. What should be mocked vs real?
8. Which 5 templates best prove value?
9. What can 1 engineer realistically finish in 4 weeks?
10. What should be removed from demo scope?
11. What must be added before production SaaS?
12. How to structure n8n workflows for easy template factory later?
13. How to prevent template output drift?
14. How to measure local performance correctly?
15. What is the smallest useful approval workflow for email draft agents?
```

---

## 21. Suggested implementation prompts

## 21.1 Master prompt for Claude/Codex

```text
You are helping implement a local demo for an Agent Operations Portal powered by self-hosted n8n.

Build only the local proof-of-product, not production SaaS.

The system has:
- frontend portal
- backend API control plane
- PostgreSQL
- self-hosted n8n
- predefined agent templates
- agent instances
- integrations
- executions
- notifications
- analytics

Important product rule:
Users cannot create arbitrary agents or edit workflow logic. Users can only create Agent Instances from predefined Agent Templates created by developers. Each template maps to an n8n workflow and defines required integrations, optional integrations, allowed trigger modes, config schema, output contract, approval mode, and cost level.

Architecture rule:
Frontend must never call n8n directly. Frontend calls backend. Backend validates template/config/integration rules, then triggers n8n webhook and receives callback result.

Implement according to the provided spec. Work module by module. Do not broad-refactor unrelated working UI. Keep the callback contract consistent across all workflows.
```

## 21.2 Backend prompt

```text
Implement the backend API control plane for the local Agent Operations Portal demo.

Scope:
- Agent Template APIs
- Agent Instance APIs
- Integration APIs
- Execution APIs
- Notification APIs
- Analytics summary API
- n8n webhook proxy
- n8n callback receiver

Rules:
- Frontend never calls n8n directly.
- Agent creation must validate template existence, allowed integrations, required integrations, trigger mode and config_schema.
- Running an agent must create an execution record before calling n8n.
- n8n callback must update execution, store output, generate notification and update analytics source data.
- Failed execution must create a notification.
- Retry must create a new execution.

Do not implement production OAuth, billing or enterprise RBAC.
```

## 21.3 Frontend prompt

```text
Connect the existing SaaS admin frontend UI to the backend APIs for the local Agent Operations Portal demo.

Required UI:
- Agents page with Agent Templates and My Agents tabs
- Create Agent Wizard
- Agent Detail page
- Execution History
- Execution Detail
- Integrations page with mock connection states
- Notifications page with actions
- Analytics summary page

Rules:
- Do not call n8n directly.
- All data must come from backend APIs.
- Show loading, empty and error states.
- User can only select integrations allowed by the selected template.
- User cannot edit workflow logic.
```

## 21.4 n8n workflow prompt

```text
Create n8n workflow JSON exports for the local Agent Operations Portal demo.

Each workflow must:
- Start with Webhook Trigger.
- Accept the standard backend payload.
- Process mock input data.
- Return normalized result.
- Callback backend using the standard callback contract.
- Include success and simulated failure paths.

Create workflows for:
1. Gmail Lead Classifier
2. Email Draft Responder
3. Slack Daily Summary
4. Google Sheet Data Checker
5. Ticket Triage Agent

Do not use real customer credentials. Use mock data by default.
```

## 21.5 QA prompt

```text
Review the local Agent Operations Portal demo implementation.

Check:
- docker compose up works from clean setup
- frontend loads
- backend APIs respond
- database seed works
- templates display from backend
- create agent validates config and integrations
- run now triggers n8n
- n8n callback updates execution
- output appears in frontend
- failed execution creates notification
- retry creates new execution
- analytics updates
- speed test works for 10, 50 and 100 executions

Report bugs with exact reproduction steps and expected vs actual behavior.
```

---

## 22. Final recommendation

For the first demo, do not chase too many templates.

Best target:

```text
4 weeks
1 engineer
Claude/Codex support
5 templates
local self-host n8n
mock integrations by default
1–2 real-ish integrations optional
```

Core proof should be:

```text
Frontend creates agent
→ Backend validates and triggers n8n
→ n8n runs workflow
→ n8n callbacks backend
→ Backend stores execution/output/notification
→ Frontend shows result and analytics
```

This proves the product model is real without over-investing in production complexity too early.
