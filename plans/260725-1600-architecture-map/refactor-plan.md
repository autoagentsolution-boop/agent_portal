# Refactor Plan — MKTAgent Full-Product (Cleanup + Hardening)

**Branch:** `refactor/full-product` · **Baseline:** 74/74 verify green (`0947b78`), tree clean.
**Decisions (locked by user):** goal = **Cleanup + Hardening** (đóng nợ kiến trúc, KHÔNG re-architecture v2). Order = **quick-wins trước** rồi god-files. Test = **characterization BẮT BUỘC trước** khi đụng bất kỳ dòng nào của một vùng.

> **▶ TRẠNG THÁI (2026-07-26): 6 open-question ĐÃ CHỐT. Đang thực thi.**
> Quyết định user: (1) Project A → archive branch rồi xóa; (2) n8n-workflows → docs/archive/; (3) roadmap → banner supersede; (4) 4 FE component xác nhận dead (grep 0 importer); (5) scale-out KHÔNG → 2.3 chỉ tách interface; (6) sendGmailAs/notifySales giữ approval-gate (không thêm flag). Bắt đầu bằng **dead-code deletion (zero-risk, grep-proven)** trước, rồi Phase 0 cho các vùng LIVE.
>
> **Correction sau grep verify (2026-07-26):**
> - `brandingVideoFlow` KHÔNG xóa cả — `demo-flow.ts` còn export `DemoMode`/`demoModeCopy`/type `FlowAgentNode` dùng LIVE ở App/PostBoard/PostCard/DemoModeToggle/ActiveFlowsPage. Xóa 4 component → `brandingVideoFlow` const mồ côi → xóa RIÊNG const đó, giữ phần còn lại file (surgical edit, không xóa file).
> - `intent-corpus.ts` KHÔNG orphan — `verify-master.ts` đã import nó. Phase 2.1 thu nhỏ: không cần tạo `verify-intent-corpus.ts` mới; corpus đã có consumer. Chỉ cân nhắc tách verify riêng nếu muốn tier rõ hơn (optional).
> - `mediaCredit` dead ở **2 chỗ** (impact-metrics.ts:79 và :119), không phải 1 — xóa cả binding + query element trong cả 2 `Promise.all`.

---

## Context — vì sao refactor này

Codebase là một single product (MKTAgent/Atria) đã trưởng thành nhanh qua ~54 plan-cycle. 6 explore-agent (báo cáo raw ở `agent-reports/`) map toàn bộ và lộ ra nợ kiến trúc CỤ THỂ, không phải cảm tính:

- **Dead code kéo bundle + gây nhầm:** `master/intent-router.ts` (không importer), 4 FE component pre-Atria (`FlowCanvas/FlowCoachPanel/WorkspaceHero/AgentCatalogPreview` + `flow/run-state.ts` + `brandingVideoFlow` template), `demo-chat.ts` stale. Cả một **Project A "Video Content Farm" đông cứng** (render-service/db/n8n/scripts/source) sống chung repo — hai Prisma schema, hai compose, hai DB, dễ nhầm cho người mới.
- **God-files quá tải:** `agent-runners.ts` (1421 dòng, ~40 outbound import — widest coupling), `workflow-executor.ts` (537), `App.tsx` (459, 20+ state đan xen), `client.ts` (745), `deterministic-analyzer.ts` (361 regex).
- **Nợ hardening lộ ra:** hand-typed DTO trong `client.ts` drift khỏi openapi (không CI bắt); `credits.ts` + `platformAssetSupport` hand-mirror backend chỉ bằng comment (không CI); SSE bus + rate-limiter + voice-throttle **in-process single-instance** (vỡ khi scale-out); `code-standards.md` rule bắt buộc nhưng không tồn tại; `development-roadmap.md` stale.
- **Ranh giới regex→LLM đã đóng Phase 0-3** (session này) nhưng corpus half-orphaned (`intent-corpus.ts` tham chiếu `verify-intent-corpus.ts` không tồn tại).

Mục tiêu: **giảm bề mặt, tách coupling, đóng drift-guard — KHÔNG đổi hành vi người dùng.** Characterization tests là hợp đồng "hành vi hôm nay" mà mọi bước phải giữ xanh.

**Nguyên tắc xuyên suốt (từ session regex→LLM):** regex = FACT extraction; LLM = INTENT. Không tái mở nợ này khi tách file.

---

## Phase 0 — Characterization safety-net (BẮT BUỘC, làm trước mọi refactor)

Không đụng một dòng product nào cho tới khi vùng đó có characterization xanh. Cơ chế: **mở rộng hệ `verify-*.ts`** (giữ pattern, không thêm framework) + **agent-browser script cho web** (không thêm dep). Có **tầng live-Gemini** (user chấp nhận token). Phủ **cả edge case**, không chỉ happy path.

### 0.1 Backend workflows (verify-*.ts, live-tier cho intent)
Viết/mở rộng characterization cho các main workflow + edge case, MỖI cái ghi hành vi HIỆN TẠI (record, không fix):
- **chat → propose → plan → execute** (happy + refine multi-turn + remove-node + kind-switch email↔marketing). Tái dùng `intent-corpus.ts`; sửa nó half-orphaned bằng cách tạo `verify-intent-corpus.ts` chạy corpus (đóng open-question #2 của agent 1).
- **campaign scope → strategist → calendar → materialize** (idempotent re-materialize, slot-fail-skip).
- **email/nurture** (write → approval gate → send DRY; opt-out absolute; reply interrupts drip).
- **credit gating** (≤0 blocks before connection gate; failed run not charged; re-run "on us"; double-count guard).
- **publish** DRY-RUN per-platform + auto-degrade carousel→image + aggregate posted/partial/error.
- **scheduler** (isPublishBlocked; reaper stuck-state guards; schedule gate preserves scheduledAt).
- **language** (content vs reply LLM-authoritative — session này; EN+VN-brand → EN reply).
Mỗi verify chạy trong `npm run verify` và phải xanh. Ghi lại "known-red baseline" NẾU phát hiện bug — **KHÔNG fix**, chỉ record + note vào plan.

### 0.2 Frontend journeys (agent-browser scripts, live stack)
Dựng full stack (BE :7100 + web :5173 + Chromium CDP :9333, user set cookie superadmin). Script characterization ghi behavior + DOM snapshot HIỆN TẠI cho:
- Command Center chat (message → flow card → approve/execute) — gồm INPUT→TEXTAREA rule, voice-priming, SSE markRunning.
- Campaign setup → PostBoard → PostCard lifecycle.
- Connections (OAuth status render) + Leads table + Nurture inbox approve/reject.
- Usage/Impact/SuperAdmin (URL-gated).
Lưu script + baseline snapshot vào `plans/260725-1600-architecture-map/characterization/`.

### 0.3 Gate
`npm run verify` = 74/74 + tất cả characterization mới xanh. FE baseline snapshot chụp xong. **Chỉ khi gate này pass mới sang Phase 1.** Commit: `test(characterization): baseline behavior before refactor`.

---

## Phase 1 — Quick wins (thấp rủi ro, thu hẹp bề mặt ngay)

Từng bước nhỏ, mỗi bước re-chạy verify + characterization, commit riêng.

### 1.1 Xác nhận + xóa dead code
Trước khi xóa, **grep xác nhận không importer** (agent đã nghi nhưng chưa chốt — đây là open-question, làm bằng grep không đoán):
- `master/intent-router.ts` (`classifyIntent`) — nếu 0 importer → xóa.
- FE: `FlowCanvas.tsx`, `FlowCoachPanel.tsx`, `WorkspaceHero.tsx`, `AgentCatalogPreview.tsx`, `flow/run-state.ts`, + `brandingVideoFlow` trong `flow/demo-flow.ts` (giữ `DemoMode` type + `demoModeCopy` — còn live). Nếu 0 importer từ App/live page → xóa.
- `orchestration/demo-chat.ts` — stale manual demo, xóa.
- `impact-metrics.ts:86` `mediaCredit` dead binding — xóa nếu confirmed unused.
Mỗi xóa = 1 commit `chore(deadcode): remove <x> (0 importers, confirmed)`. verify + tsc xanh sau mỗi cái.

### 1.2 Project A — archive (không xóa vội, user quyết cách)
Project A (`render-service/`, root `db/`, `scripts/`, `n8n-workflows/`, `source/`, output dirs, root `docker-compose.yml`, `DEMO_SCRIPT.md`) không liên quan MKTAgent. **KHÔNG tự xóa** — cần user chốt (open-question). Đề xuất mặc định: **tách sang branch `archive/video-content-farm` rồi xóa khỏi `refactor/full-product`** → repo gọn, lịch sử giữ. Chờ user OK trước khi thực thi.

### 1.3 Docs debt
- Tạo `docs/code-standards.md` canonical (trỏ `.claude/rules/development-rules.md` + tóm tắt convention thực tế). Đóng gap rule bắt buộc.
- `docs/development-roadmap.md`: refresh hoặc thêm banner "superseded by docs/product/09-today-actionable.md".
- `n8n-workflows/` → `docs/archive/` (giữ business-logic reference) — sau khi 1.2 chốt.

### 1.4 CI drift-guards (hardening, low-risk)
Thêm verify script bắt drift hand-mirror (agent 5 open-question #2):
- `verify-credits-mirror.ts`: assert FE `web/src/lib/credits.ts TOKENS_PER_CREDIT` === BE `src/cost/credits.ts`.
- `verify-platform-asset-mirror.ts`: assert FE `form-options.ts platformAssetSupport` khớp BE `social/*.ts` adapter `supports[]`.
Chạy trong `npm run verify`. Từ giờ drift = build đỏ, không phải trust-based.

**Gate Phase 1:** verify + characterization xanh. Commit theo từng mục.

---

## Phase 2 — Hardening (đóng nợ kiến trúc, behavior có kiểm soát)

### 2.1 Hoàn tất regex→LLM (đóng nốt Phase 4 đã defer)
- Sửa `intent-corpus.ts` half-orphaned: tạo `verify-intent-corpus.ts` (đã làm ở 0.1) làm consumer chính thức.
- KHÔNG chạy adversarial-verifier auto-grow (vẫn defer — user chốt cost riêng). Chỉ đảm bảo corpus là single source cho intent regression.

### 2.2 Gộp hand-typed DTO vào openapi (agent 5 open-question #3 — silent-breakage risk cao nhất FE)
- Bổ sung các route thiếu vào `contract/openapi.ts` (Workspaces, Nurture, Memory, Email, admin, plan-tiers, postability, agent-catalog) → regenerate `web/src/api/schema.d.ts` qua `npm run gen:types`.
- Xóa các interface hand-typed tương ứng trong `client.ts`, thay bằng generated types.
- Thêm CI check: `openapi.json` không stale so với router (so mounted routers vs documented paths).
- **Rủi ro:** đây là behavior-adjacent (type-only, không đổi runtime) nhưng blast-radius FE lớn → làm sau khi FE characterization xanh, re-test từng journey.

### 2.3 Scale-out prep (in-process → pluggable)
KHÔNG bắt buộc phải chuyển sang Redis ngay, nhưng **tách interface** để không khóa cứng single-instance:
- `events/bus.ts`, `connectors/runtime/rate-limit-manager.ts`, `voice-router` throttle → định nghĩa interface + giữ in-process impl mặc định + để chỗ cắm Redis. Ghi rõ "single-instance until Redis impl" trong code + docs.
- **KHÔNG** deploy multi-instance trong scope này (YAGNI) — chỉ gỡ khóa cứng để tương lai không phải sửa call-site.

### 2.4 openapi /auth/me stale fix (agent 2)
`contract/openapi.ts` /auth/me thiếu `credits/isSuperAdmin/uiLanguage` mà router trả. Đồng bộ schema (đi kèm 2.2).

**Gate Phase 2:** verify + characterization + FE journeys xanh. Openapi round-trips. Commit theo mục.

---

## Phase 3 — God-file decomposition (HIGH-risk, làm CUỐI, mỗi file một mini-track)

Chỉ vào đây khi Phase 0-2 xanh. MỖI god-file: characterization của vùng nó phục vụ PHẢI xanh trước; tách bằng **extract-module behavior-preserving** (di chuyển code, không đổi logic); re-chạy verify sau mỗi extract.

### 3.1 `agent-runners.ts` (1421 dòng, widest coupling — RISK cao nhất)
Tách theo **agent family**, giữ `getRunner` là dispatcher mỏng:
- `runners/copy-runners.ts` (concept_writer, copygen seam)
- `runners/media-runners.ts` (infographic, storyboard, video, video_script — imagegen/veo/ffmpeg)
- `runners/delivery-runners.ts` (publisher, email_agent, dm_agent, greeting_agent)
- `runners/task-runners.ts` (security, summarize)
- `runners/intelligence-runners.ts` (content_search, ideation, strategy, campaign_strategist)
Giữ MỌI hidden rule (F1 Pro-image, F21 ffmpeg pre-flight, edit-loss, security fail-closed, email language authority) — chỉ DI CHUYỂN. `verify-executor` + media/email verify phải xanh sau mỗi tách.

### 3.2 `workflow-executor.ts` (537)
Tách: gate-handling (approval/cost/publish/schedule) → `executor/gate-runner.ts`; credit-reconcile → giữ nhưng tách helper; media-gating → helper. Giữ 3 entry-point contract (router/autonomy/resume) nguyên. `verify-executor`, `verify-concept-gate`, `verify-scheduler-node` xanh.

### 3.3 `App.tsx` (459, god-component)
Tách state theo domain qua custom hooks (KHÔNG thêm state lib — giữ pattern): `use-campaigns`, `use-chats`, `use-posts`, `use-voice-mirror`, `use-nav`. Giữ MỌI StrictMode guard + useCallback-stable rule (mergePosts, ccChatOpen). FE characterization journey xanh sau mỗi hook-extract.

### 3.4 `client.ts` (745) + `deterministic-analyzer.ts` (361)
- `client.ts`: tách theo domain group (auth/campaigns/posts/orchestration/leads/nurture/...) thành `api/client/*.ts`, giữ 1 shared fetch-wrapper. Sau 2.2 (openapi) nên nhẹ hơn.
- `deterministic-analyzer.ts`: tách parser theo concern (platforms/product/campaign/video/email/removals) — nhưng CẨN THẬN, đây là no-LLM fallback đúng vai; chỉ tách file, giữ nguyên regex + verb-near-target window.

**Gate Phase 3:** verify 74/74 + tất cả characterization + FE journeys xanh. tsc sạch. Commit mỗi extract riêng để bisect dễ.

---

## Cross-cutting hazards (giữ khi refactor — từ agent-reports)
1. **"LLM-authoritative vs regex fallback"** trải khắp requirement-analyzer/deterministic-analyzer/atria-tools/detect-language/goal-merge — tách một nửa mà không nửa kia → tái mở F19/false-removal/memory-bleed/language-bleed. Giữ cùng cụm.
2. **`goal-spec.ts` = universal contract** — KHÔNG đụng schema trong refactor này (blast-radius mọi layer).
3. **Gate semantics** split registry `gate` field ↔ executor interpretation — giữ chung khi tách 3.2.
4. **`verify-planner-golden.ts`** = safety net cho planner — chạy đầu tiên mỗi lần đụng master/.
5. **master/ ↔ atria/ là PEERS không phải layer** — đừng giả định "atria trên master" khi tách.
6. **agent-runners = integration seam** — mọi thay đổi phải giữ 3 executor entry-point (router/autonomy/resume).

---

## Success criteria
- `npm run verify` = 74/74 xuyên suốt (không bao giờ đỏ giữa chừng).
- Mọi characterization (BE verify + FE agent-browser) xanh sau MỖI commit — hành vi bất biến.
- Dead code + Project A gỡ khỏi refactor branch; docs-debt đóng; CI drift-guards chạy.
- God-files < ~250 dòng/file sau tách; coupling giảm (agent-runners không còn là 1 file 1421 dòng).
- Openapi = complete contract; hand-typed DTO drift bị CI chặn.
- `tsc --noEmit` sạch; không thêm npm dep nào (verify-*.ts + agent-browser, đúng lựa chọn user).

## KHÔNG làm (YAGNI / out-of-scope)
- KHÔNG re-architecture v2 (RefactorIdea) — user chọn Cleanup+Hardening.
- KHÔNG đổi UX/feature/behavior — characterization là hợp đồng.
- KHÔNG deploy multi-instance (chỉ gỡ khóa cứng in-process, 2.3).
- KHÔNG chạy adversarial-verifier auto-grow (cost chờ user).
- KHÔNG đụng `goal-spec.ts` schema.

## Open questions — CHỐT 2026-07-26
1. **Project A** → **archive branch `archive/video-content-farm` rồi xóa** khỏi refactor branch. [1.2]
2. `n8n-workflows/` → **docs/archive/**. [1.3]
3. `development-roadmap.md` → **banner supersede** (trỏ docs/product/09-today-actionable.md). [1.3]
4. 4 FE component **XÁC NHẬN dead** — grep 0 live importer (chỉ self-ref + cross-ref trong cụm chết). Xóa. [1.1]
5. Scale-out: **KHÔNG** multi-instance gần → 2.3 **chỉ tách interface**, không impl Redis. [2.3]
6. `sendGmailAs`/`notifySales`: **giữ approval-gate**, không thêm ENABLE_LIVE flag. [bỏ khỏi 2.x]
