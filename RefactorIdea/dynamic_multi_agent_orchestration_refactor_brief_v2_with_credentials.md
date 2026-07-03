# Dynamic Multi-Agent Orchestration Refactor Brief

Bạn đang cần chuyển từ **template-based workflow** sang **goal-based agent orchestration**.

Hiện tại hệ thống của bạn đang làm kiểu:

> User chọn / mô tả nhu cầu → hệ thống map vào template có sẵn → trả flow cố định.

Cái bạn muốn là:

> User mô tả mục tiêu → Master Agent hiểu mục tiêu → hỏi thêm nếu thiếu thông tin → tự chọn agent phù hợp → tạo workflow động → chạy từng agent → output agent trước làm input agent sau → kiểm tra kết quả → hỏi duyệt trước khi publish.

## 1. Kiến trúc đúng nên là như sau

Bạn không nên để hệ thống “tự tạo agent lung tung”. Nên thiết kế theo mô hình:

```text
User Request
   ↓
Master Agent / Orchestrator
   ↓
Requirement Analyzer
   ↓
Clarification Engine
   ↓
Agent Planner
   ↓
Dynamic Workflow Graph / DAG
   ↓
Agent Executor
   ↓
Artifact Store
   ↓
Review / Approval
   ↓
Publisher
```

Trong đó:

### Master Agent

Master Agent không trực tiếp viết content, tạo infographic hay publish. Nó chỉ làm vai trò:

```text
Hiểu yêu cầu
Xác định mục tiêu
Xác định output cần có
Chọn agent phù hợp
Sắp xếp thứ tự chạy
Theo dõi kết quả
Quyết định hỏi thêm hoặc chạy tiếp
```

Ví dụ user nói:

> Tôi muốn post bài giới thiệu sản phẩm mới lên Facebook và LinkedIn.

Master Agent hiểu:

```json
{
  "goal": "marketing_post",
  "required_outputs": ["text_post"],
  "platforms": ["facebook", "linkedin"],
  "media_required": false,
  "video_required": false
}
```

Sau đó nó chọn flow:

```text
Content Search → Concept Writing → Platform Publisher
```

Nếu user nói:

> Tôi muốn bài post có infographic.

Thì flow thành:

```text
Content Search → Concept Writing → Infographic → Publisher
```

Nếu user nói:

> Tôi muốn có post, infographic và video ngắn.

Thì flow thành:

```text
Content Search → Concept Writing → Infographic → Storyboard → Video → Publisher
```

## 2. Phần quan trọng nhất: Agent Registry

Bạn cần tạo một bảng định nghĩa toàn bộ agent có sẵn. Đây là “menu năng lực” cho Master Agent chọn.

Ví dụ:

```json
[
  {
    "id": "content_search",
    "name": "Content Search Agent",
    "capabilities": ["research", "market_context", "competitor_reference"],
    "inputs": ["topic", "product", "target_audience"],
    "outputs": ["research_summary", "source_notes"],
    "required_when": ["needs_research", "marketing_content"]
  },
  {
    "id": "concept_writer",
    "name": "Concept Writing Agent",
    "capabilities": ["copywriting", "post_caption", "campaign_angle"],
    "inputs": ["research_summary", "product_info", "tone", "platforms"],
    "outputs": ["content_concept", "post_text"]
  },
  {
    "id": "infographic_agent",
    "name": "Infographic Agent",
    "capabilities": ["visual_brief", "infographic_layout", "image_prompt"],
    "inputs": ["content_concept", "post_text", "brand_style"],
    "outputs": ["infographic_brief", "image_prompt"]
  },
  {
    "id": "storyboard_agent",
    "name": "Storyboard Agent",
    "capabilities": ["video_planning", "scene_breakdown"],
    "inputs": ["content_concept", "infographic_brief"],
    "outputs": ["storyboard", "video_script"]
  },
  {
    "id": "video_agent",
    "name": "Video Agent",
    "capabilities": ["video_prompt", "short_video_generation_plan"],
    "inputs": ["storyboard", "video_script"],
    "outputs": ["video_prompt", "video_asset_reference"]
  },
  {
    "id": "publisher_agent",
    "name": "Publisher Agent",
    "capabilities": ["platform_formatting", "post_scheduling", "multi_platform_publish"],
    "inputs": ["post_text", "media_assets", "platforms"],
    "outputs": ["publish_plan", "platform_ready_posts"]
  }
]
```

Điểm mấu chốt: **Master Agent chỉ được chọn agent từ registry này**. Như vậy hệ thống kiểm soát được chất lượng, không bị hallucinate flow.

## 3. Mỗi agent phải có Input / Output contract rõ ràng

Bạn cần chuẩn hóa output của agent trước để agent sau dùng lại được.

Ví dụ output của `concept_writer`:

```json
{
  "artifact_type": "content_concept",
  "data": {
    "main_angle": "AI automation helps small teams publish faster",
    "key_message": "Reduce manual marketing work with AI agents",
    "post_text": {
      "facebook": "...",
      "linkedin": "..."
    },
    "cta": "Book a demo"
  },
  "next_recommended_agents": ["infographic_agent", "publisher_agent"]
}
```

Output này sẽ được lưu vào `artifact_store`, sau đó agent sau chỉ cần lấy:

```text
content_concept.post_text
content_concept.main_angle
content_concept.key_message
```

Không nên truyền kết quả bằng text rời rạc. Nên truyền bằng JSON có schema.

## 4. Cần thêm Clarification Engine

Đây là phần hiện tại app của bạn đang thiếu.

Master Agent phải biết khi nào cần hỏi thêm. Ví dụ user nói:

> Làm marketing flow cho sản phẩm của tôi.

Yêu cầu này thiếu nhiều thông tin:

```text
Sản phẩm gì?
Khách hàng mục tiêu là ai?
Post lên nền tảng nào?
Cần text, infographic hay video?
Tone chuyên nghiệp hay vui vẻ?
Có brand guideline không?
Có cần publish ngay không?
```

Nhưng không nên hỏi quá nhiều. Nên hỏi tối đa 3–5 câu quan trọng nhất.

Ví dụ logic:

```json
{
  "required_slots": [
    "product_name",
    "target_audience",
    "platforms",
    "output_format"
  ],
  "optional_slots": [
    "tone",
    "brand_style",
    "campaign_goal",
    "publish_schedule"
  ]
}
```

Nếu thiếu `output_format`, Master Agent hỏi:

```text
Bạn muốn output dạng nào?
1. Chỉ bài text
2. Text + infographic
3. Text + infographic + video
4. Full campaign nhiều nền tảng
```

Sau khi user chọn, Master Agent mới tạo workflow.

## 5. Workflow nên là Dynamic DAG, không phải template cứng

Thay vì lưu flow cố định như:

```text
Marketing Flow → Content Search → Concept → Infographic → Storyboard → Video → Publisher
```

Bạn nên lưu dưới dạng graph động:

```json
{
  "workflow_id": "wf_001",
  "goal": "create_marketing_assets",
  "nodes": [
    {
      "node_id": "n1",
      "agent_id": "content_search",
      "depends_on": []
    },
    {
      "node_id": "n2",
      "agent_id": "concept_writer",
      "depends_on": ["n1"]
    },
    {
      "node_id": "n3",
      "agent_id": "infographic_agent",
      "depends_on": ["n2"]
    },
    {
      "node_id": "n4",
      "agent_id": "publisher_agent",
      "depends_on": ["n2", "n3"]
    }
  ]
}
```

Khi cần video thì thêm:

```json
{
  "node_id": "n4",
  "agent_id": "storyboard_agent",
  "depends_on": ["n2", "n3"]
},
{
  "node_id": "n5",
  "agent_id": "video_agent",
  "depends_on": ["n4"]
},
{
  "node_id": "n6",
  "agent_id": "publisher_agent",
  "depends_on": ["n2", "n3", "n5"]
}
```

## 6. Cách chia module trong codebase

Bạn nên yêu cầu Claude Code refactor app thành các module như sau:

```text
/src/agents
  /registry
    agentRegistry.ts
    agentTypes.ts

  /master
    masterAgent.ts
    requirementAnalyzer.ts
    clarificationEngine.ts
    workflowPlanner.ts
    workflowValidator.ts

  /executor
    workflowExecutor.ts
    agentExecutor.ts
    artifactStore.ts

  /agents
    contentSearchAgent.ts
    conceptWriterAgent.ts
    infographicAgent.ts
    storyboardAgent.ts
    videoAgent.ts
    publisherAgent.ts

  /schemas
    userRequestSchema.ts
    workflowPlanSchema.ts
    artifactSchema.ts
    agentContractSchema.ts

  /prompts
    masterAgentPrompt.ts
    plannerPrompt.ts
    clarificationPrompt.ts
    agentPrompts.ts
```

Nếu app của bạn đang là workflow template cố định, hướng refactor là:

```text
Old:
User request → find matching template → show fixed workflow

New:
User request → analyze requirement → ask missing questions → generate workflow plan → validate workflow → execute agents step by step → return artifacts
```

## 7. Prompt/spec bạn có thể đưa cho Claude Code

Đây là phần bạn có thể copy thẳng vào Claude Code.

```text
I want to refactor my current AI workflow application from a fixed template-based system into a dynamic multi-agent orchestration system similar in behavior to Claude Code / Codex task planning.

Current behavior:
- The app can suggest predefined workflow templates.
- Example: when the user asks for a Marketing Flow, the system returns a fixed flow:
  Marketing Flow → Content Search → Concept Writing → Infographic → Storyboard → Video → Publisher.
- The agents are currently fixed inside workflow templates.
- The system cannot ask clarification questions.
- The system cannot dynamically decide which agents are needed based on the user's real goal.
- The output of one agent is not yet formally passed as a structured reference to the next agent.

Target behavior:
- Add a Master Agent / Orchestrator.
- The Master Agent should understand the user's request, extract intent, goal, required output formats, platforms, missing information, and constraints.
- If required information is missing, the system should ask concise clarification questions before creating the workflow.
- The Master Agent should dynamically select the required agents from an Agent Registry.
- The Master Agent should generate a workflow graph / DAG instead of using only fixed templates.
- Each agent should have a clear input/output contract.
- The result/artifact from each agent should be stored and passed by reference to the next agent.
- The system should support different marketing workflow variants, for example:
  1. Content Search → Concept Writing → Publisher, when the user only needs text posts.
  2. Content Search → Concept Writing → Infographic → Publisher, when the user needs text plus infographic.
  3. Content Search → Concept Writing → Infographic → Storyboard → Video → Publisher, when the user needs text, infographic, and video.
  4. Other variants based on user intent and required outputs.

Please inspect the current codebase and propose the safest refactor plan.

Implementation requirements:
1. Create an Agent Registry with metadata for each agent:
   - id
   - name
   - description
   - capabilities
   - required inputs
   - optional inputs
   - outputs
   - when to use
   - dependencies
   - execution type

2. Create a Master Agent module with these responsibilities:
   - analyze user request
   - classify intent
   - detect required output formats
   - detect target platforms
   - detect missing required fields
   - ask clarification questions when needed
   - generate a dynamic workflow plan
   - validate that all selected agents have required inputs
   - return the final workflow plan for user approval

3. Create a Clarification Engine:
   - define required slots for each workflow type
   - ask no more than 3–5 high-impact questions at once
   - avoid asking questions when the system can safely infer the answer
   - support multiple-choice questions for output format, platforms, and campaign goal

4. Create a Workflow Planner:
   - input: analyzed user requirement + agent registry
   - output: workflow graph / DAG
   - each node should include:
     - node_id
     - agent_id
     - depends_on
     - input_artifact_refs
     - expected_output_artifacts
     - status

5. Create an Artifact Store:
   - store output from each agent as structured JSON
   - allow downstream agents to reference previous outputs by artifact id
   - avoid passing long unstructured text between agents
   - support artifact types such as:
     - research_summary
     - content_concept
     - post_text
     - infographic_brief
     - image_prompt
     - storyboard
     - video_script
     - video_prompt
     - platform_ready_post
     - publish_plan

6. Create Agent Contracts:
   - each agent must declare its input schema and output schema
   - the executor should validate input before running each agent
   - the executor should validate output after each agent completes
   - if validation fails, return a recoverable error to the Master Agent

7. Create a Workflow Executor:
   - execute the DAG in dependency order
   - pass artifact references from previous agents into downstream agents
   - stop execution if a required artifact is missing
   - support human approval before publishing
   - support retry or revision of a failed agent step

8. Keep the existing workflow templates as examples or fallback presets, but do not make them the primary logic anymore.
   The primary logic should be:
   User goal → requirement analysis → clarification → dynamic agent selection → workflow graph → execution.

9. Please implement this incrementally:
   Phase 1: Agent Registry + Master Agent requirement analysis + workflow plan generation only.
   Phase 2: Clarification Engine.
   Phase 3: Artifact Store and Agent Contracts.
   Phase 4: Workflow Executor.
   Phase 5: Human approval and Publisher integration.

10. Before coding, generate:
   - proposed folder structure
   - TypeScript interfaces or equivalent data models
   - example workflow plan JSON for:
     a. text-only marketing post
     b. text + infographic post
     c. text + infographic + video campaign
   - migration plan from current template-based workflow to dynamic workflow planning

Important:
- Do not remove the existing template system immediately.
- Preserve current functionality.
- Add the new dynamic orchestration layer beside the existing implementation first.
- Prefer clear schema-driven design over hardcoded if/else logic.
- Make the implementation testable.
- Add unit tests for requirement analysis, agent selection, workflow planning, and artifact passing.
```

## 8. Câu ngắn gọn để bạn giải thích cho dev/team

Bạn có thể nói như này:

> Hệ thống hiện tại là template-based workflow. Tôi muốn nâng cấp thành goal-based orchestration. User không cần chọn flow cố định nữa. Master Agent sẽ hiểu mục tiêu, hỏi thêm nếu thiếu thông tin, chọn agent từ registry, tạo workflow graph động, sau đó execute từng agent theo dependency. Output của agent trước được lưu thành artifact có schema rõ ràng và được agent sau dùng lại bằng reference.

## 9. MVP nên làm trước

Đừng build full ngay. Làm theo thứ tự này:

### MVP 1: Dynamic planning, chưa cần auto execute

User nhập request, hệ thống trả về:

```text
Tôi hiểu bạn cần:
- Text post
- Infographic
- Facebook + LinkedIn

Workflow đề xuất:
1. Content Search
2. Concept Writing
3. Infographic
4. Publisher

Bạn có muốn chạy workflow này không?
```

### MVP 2: Hỏi clarification

Nếu thiếu thông tin, hệ thống hỏi:

```text
Bạn muốn tạo loại nội dung nào?
1. Chỉ text post
2. Text + infographic
3. Text + infographic + video
```

### MVP 3: Artifact passing

Agent trước tạo JSON. Agent sau đọc JSON đó.

### MVP 4: Auto execute

Sau khi user approve workflow, hệ thống chạy từng agent.

### MVP 5: Publisher thật

Chỉ publish sau khi có human approval.

## 10. Logic chọn agent nên viết thế này

Ví dụ rule ban đầu:

```ts
if (requiresResearch) addAgent("content_search");
if (requiresTextPost) addAgent("concept_writer");
if (requiresInfographic) addAgent("infographic_agent");
if (requiresVideo) {
  addAgent("storyboard_agent");
  addAgent("video_agent");
}
if (requiresPublishing) addAgent("publisher_agent");
```

Sau này có thể nâng cấp thành LLM planner, nhưng MVP nên bắt đầu bằng rule + schema. Đừng để LLM quyết định hoàn toàn từ đầu vì rất khó debug.

Mô hình tốt nhất cho bạn hiện tại là:

```text
Rule-based control + LLM reasoning
```

Không nên là:

```text
LLM tự làm hết
```

Vì app của bạn liên quan tới workflow, content, media, publisher, nếu không có schema và rule thì rất dễ sai flow, thiếu step, hoặc publish nhầm.

## Kết luận thiết kế

Bạn nên chuyển app thành 5 lớp:

```text
1. Requirement Layer
   Hiểu user muốn gì.

2. Planning Layer
   Chọn agent và tạo workflow graph.

3. Contract Layer
   Chuẩn hóa input/output giữa agent.

4. Execution Layer
   Chạy agent theo thứ tự dependency.

5. Review/Approval Layer
   Cho user duyệt trước khi publish.
```

Câu quan trọng nhất để nói với Claude Code là:

> Refactor the app from fixed workflow templates into a schema-driven dynamic agent orchestration system with a Master Agent, Agent Registry, Clarification Engine, Workflow Planner, Artifact Store, Agent Contracts, and DAG Executor. Keep existing templates as fallback only.
---

## 11. Bổ sung quan trọng: Credential, Connection và Schemaless Platform Connector Layer

Một phần rất quan trọng của hệ thống multi-agent orchestration là các agent không chỉ tạo nội dung, mà còn cần tương tác với các platform thật như Facebook, LinkedIn, TikTok, Instagram, YouTube, WordPress, Shopify, Gmail, Google Drive, Canva, Slack, CRM, hoặc các hệ thống nội bộ.

Vì mỗi platform có cách authentication, authorization, API contract, rate limit, permission scope và data requirement khác nhau, không nên hardcode credential trực tiếp vào agent hoặc tạo nhiều cột cố định trong database cho từng platform.

Thiết kế đúng nên là:

```text
Agent không giữ credential thật.
Agent chỉ yêu cầu capability.
Executor nhận connection reference.
Connector Runtime lấy credential an toàn từ Credential Vault.
Connector Runtime gọi platform API.
Kết quả được lưu lại thành artifact.
```

Nói cách khác:

```text
Agent → cần publish lên Facebook
Master Agent / Planner → kiểm tra capability cần có
Connection Resolver → tìm connection phù hợp của user/team
Executor → gọi Connector Runtime bằng connection_ref
Connector Runtime → lấy secret từ Vault
Platform Adapter → gọi API thật
Artifact Store → lưu kết quả publish / error / platform response
```

### 11.1. Không nên để agent trực tiếp cầm token/key

Không nên thiết kế kiểu:

```text
Publisher Agent nhận access_token rồi gọi Facebook API trực tiếp.
```

Vì cách này có các rủi ro:

```text
LLM có thể nhìn thấy token.
Token có thể bị log ra prompt / response / trace.
Khó kiểm soát scope.
Khó revoke.
Khó audit.
Khó thay platform auth method.
Khó bảo mật multi-tenant.
```

Thiết kế đúng hơn:

```text
Publisher Agent chỉ nhận connection_id hoặc connection_ref.
Backend Connector Runtime mới có quyền resolve credential thật.
Credential thật được lưu trong vault hoặc encrypted secret store.
LLM không bao giờ nhìn thấy raw token, refresh token, API key hoặc password.
```

### 11.2. Schemaless không có nghĩa là không có cấu trúc

Nên hiểu đúng:

```text
Không nên schema cứng cho từng platform trong DB.
Nhưng vẫn cần contract tối thiểu cho security, ownership, audit và runtime.
```

Thiết kế nên là:

```text
Stable core schema + schemaless config/metadata/secret payload
```

Ví dụ core table tối thiểu:

```ts
interface ConnectionRecord {
  id: string;
  tenantId: string;
  userId?: string;
  teamId?: string;
  platformKey: string;
  connectionType: string;
  displayName: string;
  status: 'active' | 'expired' | 'revoked' | 'error' | 'pending';
  capabilities: string[];
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  secretRef: string;
  createdAt: string;
  updatedAt: string;
}
```

Trong đó:

```text
platformKey: facebook | linkedin | tiktok | wordpress | shopify | gmail | custom_api | etc.
connectionType: oauth2 | api_key | bearer_token | basic_auth | service_account | webhook | custom
capabilities: danh sách quyền/capability mà connection này hỗ trợ
config: cấu hình không nhạy cảm, có thể lưu dạng JSONB/schemaless
metadata: thông tin phụ, page id, workspace id, organization id, account name, avatar, limits
secretRef: pointer tới nơi lưu secret thật
```

Không nên tạo DB kiểu này:

```text
facebook_access_token
facebook_page_id
linkedin_access_token
linkedin_organization_id
tiktok_access_token
youtube_refresh_token
wordpress_username
wordpress_password
...
```

Vì mỗi lần thêm platform sẽ phải migration database, code dễ phình to và rất khó maintain.

### 11.3. Credential Vault / Secret Store

Credential thật nên được lưu trong một lớp riêng:

```text
Credential Vault
```

Có thể dùng một trong các option:

```text
AWS Secrets Manager
Google Secret Manager
Azure Key Vault
HashiCorp Vault
Supabase Vault
Encrypted PostgreSQL JSONB với KMS/application-level encryption
Encrypted MongoDB collection
```

MVP có thể dùng encrypted database field, nhưng production nên tách secret vault.

Ví dụ secret payload schemaless:

```json
{
  "auth_type": "oauth2",
  "access_token": "encrypted_or_vault_managed_value",
  "refresh_token": "encrypted_or_vault_managed_value",
  "expires_at": "2026-07-30T10:00:00Z",
  "scope": ["pages_manage_posts", "pages_read_engagement"],
  "token_type": "Bearer"
}
```

Hoặc API key:

```json
{
  "auth_type": "api_key",
  "api_key": "encrypted_or_vault_managed_value",
  "header_name": "X-API-Key"
}
```

Hoặc custom API:

```json
{
  "auth_type": "custom",
  "base_url": "https://api.customer-system.com",
  "headers": {
    "Authorization": "encrypted_or_vault_managed_value"
  },
  "extra": {
    "workspace_id": "abc_123"
  }
}
```

Quan trọng:

```text
Secret payload có thể schemaless.
Nhưng secret payload không được expose cho LLM.
Chỉ Connector Runtime được quyền đọc secret payload.
```

### 11.4. Connector Registry

Ngoài Agent Registry, nên có thêm Connector Registry.

Agent Registry trả lời câu hỏi:

```text
Agent nào có thể làm task gì?
```

Connector Registry trả lời câu hỏi:

```text
Platform nào có thể connect bằng cách nào?
Platform đó hỗ trợ action/capability nào?
Platform đó cần config gì?
Platform đó cần permission scope nào?
Platform đó có rate limit/media constraint gì?
```

Ví dụ:

```ts
interface ConnectorDefinition {
  platformKey: string;
  name: string;
  authStrategies: AuthStrategyDefinition[];
  capabilities: ConnectorCapability[];
  configSchema?: Record<string, unknown>;
  credentialSchema?: Record<string, unknown>;
  actions: ConnectorActionDefinition[];
  rateLimit?: Record<string, unknown>;
  mediaConstraints?: Record<string, unknown>;
}
```

Ví dụ Facebook connector:

```json
{
  "platformKey": "facebook",
  "name": "Facebook Pages",
  "authStrategies": [
    {
      "type": "oauth2",
      "requiredScopes": ["pages_manage_posts", "pages_read_engagement"]
    }
  ],
  "capabilities": [
    "social.post.text",
    "social.post.image",
    "social.post.video",
    "social.schedule.post"
  ],
  "actions": [
    {
      "actionKey": "publish_text_post",
      "requiredCapabilities": ["social.post.text"],
      "requiredInputs": ["page_id", "message"]
    },
    {
      "actionKey": "publish_image_post",
      "requiredCapabilities": ["social.post.image"],
      "requiredInputs": ["page_id", "message", "image_asset_ref"]
    }
  ],
  "mediaConstraints": {
    "imageFormats": ["jpg", "png"],
    "videoFormats": ["mp4"],
    "maxVideoDurationSec": 90
  }
}
```

Ví dụ LinkedIn connector:

```json
{
  "platformKey": "linkedin",
  "name": "LinkedIn",
  "authStrategies": [
    {
      "type": "oauth2",
      "requiredScopes": ["w_member_social", "w_organization_social"]
    }
  ],
  "capabilities": [
    "social.post.text",
    "social.post.image",
    "social.organization.post"
  ],
  "actions": [
    {
      "actionKey": "publish_member_post",
      "requiredCapabilities": ["social.post.text"],
      "requiredInputs": ["author_urn", "commentary"]
    },
    {
      "actionKey": "publish_organization_post",
      "requiredCapabilities": ["social.organization.post"],
      "requiredInputs": ["organization_urn", "commentary"]
    }
  ]
}
```

### 11.5. Capability-based planning thay vì platform hardcode

Master Agent không nên nói:

```text
Cần gọi Facebook API function X.
```

Master Agent nên nói:

```text
Workflow này cần capability: social.post.text, social.post.image, social.post.video.
Target platforms: facebook, linkedin.
```

Sau đó Connection Resolver kiểm tra:

```text
User/team có connection nào active cho facebook có capability social.post.image không?
User/team có connection nào active cho linkedin có capability social.post.text không?
Token còn hạn không?
Scope đủ không?
Có cần reconnect không?
```

Ví dụ workflow node:

```json
{
  "node_id": "n5",
  "agent_id": "publisher_agent",
  "depends_on": ["n2", "n3"],
  "required_capabilities": [
    "social.post.text",
    "social.post.image"
  ],
  "target_platforms": ["facebook", "linkedin"],
  "connection_refs": [
    "conn_facebook_page_001",
    "conn_linkedin_org_001"
  ],
  "input_artifact_refs": [
    "artifact_post_text_001",
    "artifact_infographic_001"
  ],
  "expected_output_artifacts": [
    "platform_ready_posts",
    "publish_result"
  ],
  "requires_human_approval": true
}
```

### 11.6. Connection Resolver

Cần thêm một module:

```text
Connection Resolver
```

Vai trò:

```text
Nhận required platform + capability từ workflow plan.
Tìm connection active phù hợp.
Kiểm tra status/token/scope.
Trả connection_ref cho Executor.
Nếu thiếu connection thì tạo action yêu cầu user connect platform.
Nếu token hết hạn thì refresh hoặc yêu cầu reconnect.
Nếu platform có nhiều account/page/workspace thì hỏi user chọn.
```

Ví dụ:

```ts
interface ConnectionResolutionRequest {
  tenantId: string;
  userId: string;
  targetPlatforms: string[];
  requiredCapabilities: string[];
}

interface ConnectionResolutionResult {
  status: 'resolved' | 'missing_connection' | 'expired' | 'requires_selection' | 'insufficient_scope';
  resolvedConnections: Array<{
    platformKey: string;
    connectionId: string;
    displayName: string;
    capabilities: string[];
  }>;
  requiredUserAction?: {
    type: 'connect_platform' | 'reconnect_platform' | 'select_account' | 'grant_permission';
    message: string;
    options?: Array<Record<string, unknown>>;
  };
}
```

### 11.7. Connector Runtime

Cần thêm một module:

```text
Connector Runtime
```

Đây là lớp duy nhất được quyền dùng credential thật để gọi platform.

```text
Agent Executor không gọi trực tiếp Facebook/LinkedIn/TikTok API.
Agent Executor gọi Connector Runtime.
Connector Runtime resolve secretRef.
Connector Runtime chọn Platform Adapter.
Platform Adapter gọi API thật.
Connector Runtime redact sensitive fields trước khi log hoặc trả kết quả.
```

Ví dụ interface:

```ts
interface ConnectorRuntimeInvokeRequest {
  tenantId: string;
  connectionId: string;
  platformKey: string;
  actionKey: string;
  input: Record<string, unknown>;
  artifactRefs?: string[];
  idempotencyKey?: string;
}

interface ConnectorRuntimeInvokeResult {
  status: 'success' | 'failed' | 'retryable_error' | 'requires_reconnect';
  platformKey: string;
  actionKey: string;
  externalId?: string;
  externalUrl?: string;
  responseMetadata?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

### 11.8. Platform Adapter pattern

Mỗi platform nên có adapter riêng, nhưng cùng implement một contract chung.

```text
/connectors
  /facebook
    facebook.definition.ts
    facebook.adapter.ts
    facebook.oauth.ts
  /linkedin
    linkedin.definition.ts
    linkedin.adapter.ts
    linkedin.oauth.ts
  /tiktok
    tiktok.definition.ts
    tiktok.adapter.ts
    tiktok.oauth.ts
  /wordpress
    wordpress.definition.ts
    wordpress.adapter.ts
  /customApi
    customApi.definition.ts
    customApi.adapter.ts
```

Ví dụ:

```ts
interface PlatformAdapter {
  platformKey: string;

  validateConnection(connection: ConnectionRecord): Promise<ConnectionValidationResult>;

  refreshCredential?(connection: ConnectionRecord): Promise<CredentialRefreshResult>;

  invokeAction(request: ConnectorRuntimeInvokeRequest): Promise<ConnectorRuntimeInvokeResult>;
}
```

Điểm quan trọng:

```text
Thêm platform mới = thêm connector definition + adapter.
Không cần đổi agent.
Không cần đổi Master Agent.
Không cần migration nhiều cột DB.
Không cần sửa Publisher Agent nếu capability/action mapping đã chuẩn.
```

### 11.9. Schemaless config nhưng vẫn cần validation theo connector

Mặc dù DB lưu `config` và `metadata` dạng JSONB/schemaless, mỗi connector vẫn nên có validation riêng.

Ví dụ Facebook cần:

```json
{
  "page_id": "required",
  "page_name": "optional",
  "default_timezone": "optional"
}
```

WordPress cần:

```json
{
  "site_url": "required",
  "default_category_id": "optional",
  "default_author_id": "optional"
}
```

Shopify cần:

```json
{
  "shop_domain": "required",
  "default_collection_id": "optional"
}
```

Tức là:

```text
DB không ép schema cứng.
Connector definition ép schema ở runtime.
```

Đây là mô hình:

```text
Schema-on-read / schema-on-execute
```

Không phải:

```text
No schema at all
```

### 11.10. Agent Registry cần bổ sung credential/capability awareness

Agent Registry hiện tại nên bổ sung thêm các field sau:

```json
{
  "id": "publisher_agent",
  "name": "Publisher Agent",
  "capabilities": [
    "platform_formatting",
    "post_scheduling",
    "multi_platform_publish"
  ],
  "required_connector_capabilities": [
    "social.post.text",
    "social.post.image",
    "social.post.video"
  ],
  "requires_connection": true,
  "requires_human_approval": true,
  "inputs": ["post_text", "media_assets", "platforms", "connection_refs"],
  "outputs": ["publish_plan", "platform_ready_posts", "publish_result"]
}
```

Với agent không cần external platform, field này có thể false:

```json
{
  "id": "concept_writer",
  "requires_connection": false
}
```

### 11.11. Workflow Planner cần check connection trước khi execute

Flow mới nên là:

```text
User Request
  ↓
Requirement Analyzer
  ↓
Clarification Engine
  ↓
Workflow Planner
  ↓
Capability Resolver
  ↓
Connection Resolver
  ↓
Workflow Plan with connection_refs
  ↓
Human Approval
  ↓
Workflow Executor
  ↓
Connector Runtime
  ↓
Platform API
```

Nếu thiếu credential, hệ thống không nên fail khó hiểu. Nó nên trả về:

```json
{
  "status": "requires_user_action",
  "required_action": {
    "type": "connect_platform",
    "platform": "facebook",
    "reason": "The selected workflow requires permission to publish text and image posts to a Facebook Page.",
    "required_scopes": ["pages_manage_posts", "pages_read_engagement"]
  }
}
```

Hoặc nếu đã connect nhưng thiếu quyền:

```json
{
  "status": "requires_user_action",
  "required_action": {
    "type": "grant_permission",
    "platform": "linkedin",
    "reason": "The current LinkedIn connection can publish member posts but does not have organization posting permission.",
    "required_scopes": ["w_organization_social"]
  }
}
```

### 11.12. Human approval bắt buộc trước khi publish

Với mọi agent có quyền ghi ra bên ngoài như:

```text
publish post
send email
update CRM
create campaign
upload video
schedule post
delete content
change product data
```

Nên có approval gate.

Ví dụ:

```json
{
  "approval_gate": {
    "required": true,
    "reason": "This workflow will publish content to external platforms.",
    "preview_artifacts": [
      "platform_ready_posts",
      "infographic_asset",
      "video_asset"
    ],
    "actions_after_approval": [
      "publish_to_facebook",
      "publish_to_linkedin"
    ]
  }
}
```

MVP có thể cho phép:

```text
Approve all
Approve selected platform only
Request revision
Cancel publish
Save as draft
Schedule later
```

### 11.13. Audit log và security log

Mọi external action cần có audit log:

```ts
interface ExternalActionAuditLog {
  id: string;
  tenantId: string;
  userId: string;
  workflowId: string;
  nodeId: string;
  agentId: string;
  platformKey: string;
  connectionId: string;
  actionKey: string;
  approvalId?: string;
  status: 'success' | 'failed' | 'cancelled' | 'skipped';
  externalId?: string;
  externalUrl?: string;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown>;
  error?: Record<string, unknown>;
  createdAt: string;
}
```

Lưu ý:

```text
Không log raw token.
Không log refresh token.
Không log API key.
Không log password.
Không log full sensitive payload.
Log phải redact secrets tự động.
```

### 11.14. Data model đề xuất cho schemaless connector layer

Nếu dùng PostgreSQL:

```sql
CREATE TABLE connections (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID NULL,
  team_id UUID NULL,
  platform_key TEXT NOT NULL,
  connection_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '[]',
  config JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  secret_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_connections_tenant_platform
ON connections (tenant_id, platform_key);

CREATE INDEX idx_connections_capabilities
ON connections USING GIN (capabilities);
```

Nếu muốn linh hoạt hơn nữa, có thể thêm:

```sql
CREATE TABLE connector_definitions (
  platform_key TEXT PRIMARY KEY,
  definition JSONB NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Tuy nhiên, với MVP nên để connector definitions trong code để dễ control version.

### 11.15. Cấu trúc folder bổ sung

Nên bổ sung vào codebase:

```text
/src/connectors
  /registry
    connectorRegistry.ts
    connectorTypes.ts
    capabilityTypes.ts

  /runtime
    connectorRuntime.ts
    connectionResolver.ts
    credentialResolver.ts
    secretRedactor.ts
    rateLimitManager.ts
    idempotencyManager.ts

  /vault
    credentialVault.ts
    encryptedDbVault.ts
    awsSecretsManagerVault.ts

  /platforms
    /facebook
      facebook.definition.ts
      facebook.adapter.ts
      facebook.oauth.ts
    /linkedin
      linkedin.definition.ts
      linkedin.adapter.ts
      linkedin.oauth.ts
    /tiktok
      tiktok.definition.ts
      tiktok.adapter.ts
      tiktok.oauth.ts
    /wordpress
      wordpress.definition.ts
      wordpress.adapter.ts
    /customApi
      customApi.definition.ts
      customApi.adapter.ts

/src/approvals
  approvalTypes.ts
  approvalService.ts
  approvalPolicy.ts

/src/audit
  externalActionAuditLog.ts
  auditRedaction.ts
```

### 11.16. Prompt bổ sung để đưa cho Claude Code

Phần này có thể thêm vào prompt/spec hiện tại:

```text
Additional requirement: Credential, Connection, and Schemaless Connector Layer

The dynamic multi-agent orchestration system must support external platform connections and credentials in a flexible and secure way.

Current concern:
- Different platforms use different authentication methods: OAuth2, API key, bearer token, basic auth, service account, webhook secret, or custom authentication.
- Different platforms require different metadata and config: page id, organization id, workspace id, shop domain, site url, channel id, media constraints, scopes, rate limits, etc.
- I do not want to add many fixed database columns for every new platform.
- I want the system to be flexible enough to add new platforms/connectors without heavy DB migrations.

Target design:
1. Add a schemaless Connection Layer.
   - Use a stable minimal core schema for ownership, platform key, status, capabilities, and secret reference.
   - Store platform-specific non-sensitive configuration in JSON/JSONB fields.
   - Store platform-specific metadata in JSON/JSONB fields.
   - Store real credentials/secrets in a separate Credential Vault or encrypted secret store.
   - The database should not need new columns every time a new platform is added.

2. Add a Credential Vault abstraction.
   - Do not expose raw credentials to LLM agents.
   - Do not pass access tokens, refresh tokens, API keys, passwords, or client secrets into prompts.
   - Agents should only receive connection_id or connection_ref.
   - Only the backend Connector Runtime can resolve secretRef and use the real credential.
   - All logs and traces must redact secrets.

3. Add a Connector Registry.
   - Define each platform connector with:
     - platformKey
     - name
     - supported auth strategies
     - required scopes
     - supported capabilities
     - actions
     - required inputs per action
     - optional inputs per action
     - media constraints
     - rate limit metadata
   - Keep connector definitions in code for MVP.
   - Optionally support connector definitions from JSONB later.

4. Add capability-based planning.
   - The Master Agent should not hardcode platform API calls.
   - The Master Agent should identify required connector capabilities such as:
     - social.post.text
     - social.post.image
     - social.post.video
     - social.schedule.post
     - email.send
     - file.upload
     - crm.create.lead
   - The Connection Resolver should map required capabilities to available user/team connections.

5. Add Connection Resolver.
   - Given tenantId, userId/teamId, target platforms, and required capabilities, resolve usable connections.
   - If no connection exists, return a required user action: connect_platform.
   - If a token is expired, refresh it if possible or return reconnect_platform.
   - If permission scope is insufficient, return grant_permission.
   - If multiple accounts/pages/workspaces are available, return select_account.

6. Add Connector Runtime.
   - The Workflow Executor should call Connector Runtime instead of calling platform APIs directly.
   - Connector Runtime should:
     - resolve connection
     - load secret from Credential Vault
     - validate action input
     - call the correct Platform Adapter
     - handle rate limit, retry, idempotency, and errors
     - redact sensitive data from logs
     - return structured execution result

7. Add Platform Adapter pattern.
   - Each platform should have its own adapter, but all adapters should implement a shared interface.
   - Adding a new platform should require adding a connector definition and adapter only, not changing the Master Agent or core workflow planner.

8. Add human approval before external write actions.
   - Publishing, sending emails, updating CRM, creating campaigns, uploading videos, deleting content, or modifying external systems must require approval before execution.
   - The system should support approve, reject, request revision, save draft, schedule later, or approve selected platforms only.

9. Add audit logs.
   - Every external platform action must create an audit log.
   - The audit log should include tenant, user, workflow, node, agent, platform, connection, action, approval, status, external id/url, sanitized request summary, sanitized response summary, and error summary.
   - Never log raw credentials.

10. Update the proposed folder structure with:
   - /src/connectors/registry
   - /src/connectors/runtime
   - /src/connectors/vault
   - /src/connectors/platforms
   - /src/approvals
   - /src/audit

11. Update the workflow plan schema so nodes can declare:
   - required_connector_capabilities
   - target_platforms
   - connection_refs
   - requires_human_approval
   - external_action_policy

12. Update the MVP phases:
   - Phase 1: Agent Registry + Master Agent requirement analysis + dynamic workflow plan.
   - Phase 2: Clarification Engine.
   - Phase 3: Artifact Store and Agent Contracts.
   - Phase 4: Schemaless Connection Layer + Credential Vault abstraction.
   - Phase 5: Connector Registry + Connection Resolver.
   - Phase 6: Workflow Executor + Connector Runtime.
   - Phase 7: Human approval + Publisher integration.
   - Phase 8: Audit log, retry, rate limit, idempotency, and production hardening.

Please refactor incrementally and preserve existing template workflow behavior as fallback.
```

### 11.17. Câu ngắn gọn để nói với Claude Code về phần credential

```text
Add a schemaless credential and connector layer. Agents must not receive raw credentials. Each agent should request capabilities, not tokens. The system should resolve connection_refs through a Connection Resolver and use a backend Connector Runtime to load encrypted credentials from a Vault and call platform-specific adapters. Store platform-specific config/metadata as JSONB to avoid DB migrations when adding new platforms, but keep a minimal stable core schema for ownership, status, capabilities, audit, and secret references.
```

### 11.18. Kết luận bổ sung

Thiết kế mới nên tách rõ 3 lớp:

```text
Agent Layer
- Hiểu việc cần làm.
- Sinh content/artifact.
- Yêu cầu capability.
- Không biết credential thật.

Connector Layer
- Biết platform nào có action nào.
- Biết connection nào đủ quyền.
- Biết gọi API nào.
- Biết refresh/retry/rate limit.

Credential Layer
- Lưu secret an toàn.
- Không expose secret cho LLM.
- Redact log.
- Quản lý revoke/refresh/rotation.
```

Cách này sẽ giúp hệ thống vừa flexible, vừa an toàn, vừa dễ mở rộng platform mới mà không phải liên tục sửa database hoặc rewrite lại từng agent.
