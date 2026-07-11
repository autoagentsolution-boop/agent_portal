# Atria — Lộ trình Track A & Track B (Investor + Tuyển dụng)

> Tài liệu chiến lược, 2026-07-11. Dùng để (1) trao đổi với investor và (2) mô tả công việc/tuyển nhân sự.
> Căn cứ trên codebase thật (`MKTAgent/`, branch `pivot/video-content-farm`). Ước lượng effort là *khoảng*, không phải cam kết.

---

## 0. TL;DR (1 phút cho investor)

**Atria hôm nay đã chạy thật:** một AI assistant "general-first" — hiểu yêu cầu người dùng bằng ngôn ngữ tự nhiên (mọi ngôn ngữ), tự dựng workflow (chuỗi agent chuyên trách), điều phối chúng, và thực thi **chỉ sau khi người dùng duyệt** các bước chạm ra bên ngoài. Đã kiểm chứng end-to-end: gửi email thật qua Gmail, trả số liệu hiệu quả thật, đăng đa nền tảng (FB/IG/Threads/X/LinkedIn).

**Hai hướng phát triển tiếp theo:**
- **Track A — Composable Agent Platform (nền tảng "cắm là chạy"):** biến Atria từ một công cụ *marketing* thành một *OS agent* mở rộng được. Thêm năng lực mới (dịch, tóm tắt, phân tích tài liệu, CSKH, phân tích dữ liệu…) chỉ bằng "cắm một node" — không viết lại lõi. → Ra tính năng nhanh, chi phí thấp, biên lợi nhuận cao.
- **Track B — Autonomous Agent Workforce (đội sub-agent tự chủ):** mỗi node trở thành một agent tự suy luận, tự dùng công cụ, tự kiểm/sửa; Atria có thể *spawn động* các sub-agent phối hợp dưới sự chỉ đạo của nó. → "Lực lượng lao động AI" — khác biệt lớn, chất lượng cao, nhưng tốn token và cần đội mạnh.

**Quan hệ:** A là **nền bắt buộc** cho B. A rẻ + nhanh (nền tảng); B là "moat" nhưng nặng. Chiến lược đề xuất: **A trước → B theo từng node**, có kiểm soát chi phí.

---

## 1. Hiện trạng — điểm xuất phát (đã build + verify)

Substrate đã có và đã kiểm chứng — đây là tài sản, không phải bắt đầu từ 0:

| Thành phần | Trạng thái | Ý nghĩa |
|---|---|---|
| **Reasoning brain** (function-calling loop, có tool, có budget/deadline) | ✅ Live, verified | Atria hiểu ý người dùng và tự chọn hành động — không hardcode |
| **Agent registry + planner** (chọn agent, **tự suy ra cạnh DAG** qua produces↔requires) | ✅ Live | Xương sống điều phối; thêm node → tự nối luồng |
| **DAG executor + approval gates** (chặn ở bước chạm production/gửi/tốn tiền) | ✅ Live | An toàn: không tự ý gửi/đăng khi chưa duyệt |
| **Cost ledger** (đo token mọi surface, quy ra credit) | ✅ Live | Kiểm soát chi phí per-tenant — nền cho unit economics |
| **Memory** (nhớ sản phẩm/brand/audience qua phiên), **connectors** (OAuth đa nền tảng), **publish paths** (Drive→social), **context caching** | ✅ Live | Trải nghiệm liền mạch, chi phí tối ưu |

**Trung thực về giới hạn hiện tại** (chính là việc của A/B):
- Mỗi "agent node" hiện là **1 lần gọi LLM** (chưa tự chủ, chưa lặp/tự sửa).
- Việc **chọn agent** vẫn đóng khung marketing (if-ladder theo cờ marketing).
- **Chỉ dùng Gemini** (chưa trừu tượng hóa nhà cung cấp mô hình).

---

## 2. TRACK A — Composable Agent Platform (P1b)

### 2.1 Mục tiêu
Bất kỳ node nào (hiện tại hoặc tương lai) **chạy độc lập HOẶC ghép chuỗi**, và **cắm vào registry + một runner là chạy, không cần đụng lõi**. Xóa "đóng khung marketing" ở tầng cấu trúc → Atria thành nền tảng agent tổng quát.

### 2.2 Phạm vi kỹ thuật
- **C1 — Chọn agent theo dữ liệu (backward-chaining):** thay if-ladder marketing bằng "muốn output X → node nào `produces` X → truy hồi `requires` → tập node tối thiểu". Registry đã khai báo produces/requires; chỉ cần bộ chọn tiêu thụ nó. *(Cạnh đã data-driven sẵn — chỉ còn khâu chọn.)*
- **C2 — Hợp đồng đề xuất tổng quát (`WorkflowProposal`):** tách khỏi `MasterAgentOutcome` (đang mang hình marketing). Marketing planner trở thành **một** nguồn tạo proposal; một luồng "phân tích tài liệu → tóm tắt → email" là nguồn khác.
- **C3 — `TaskSpec` tổng quát:** cho các ý định phi-marketing ("dịch tài liệu này", "tóm tắt 3 URL"), bên cạnh GoalSpec marketing.
- **Node SDK/contract chuẩn hóa:** một khuôn (declare produces/requires/gate/cost + một runner) để **người ngoài team/ tương lai thêm node dễ dàng**.

### 2.3 Phases & deliverables
| Phase | Việc | Deliverable | Effort (eng-tuần) |
|---|---|---|---|
| A.0 | **Golden-master test** planner (đã xong) | 15 case khóa hành vi, net an toàn | ✅ Done |
| A.1 | C1 backward-chaining selection (sau golden-master) | Planner data-driven, diff-clean mọi luồng marketing | 1.5–2.5 |
| A.2 | Node SDK + 1 node phi-marketing mẫu (summarize/translate) | Chứng minh "cắm là chạy" | 1–2 |
| A.3 | C2 `WorkflowProposal` + adapter (bọc MasterAgentOutcome trước, không vỡ downstream) | Hợp đồng tổng quát | 2–3 |
| A.4 | C3 `TaskSpec` + brain route sang task phi-marketing | Atria nhận task tổng quát | 1.5–2.5 |
| A.5 | Docs + eval + verify toàn luồng | Tài liệu node-authoring, test regression | 1 |
| **Tổng A** | | | **~7–11 eng-tuần** |

### 2.4 Rủi ro & giảm thiểu
- *Regression luồng đang chạy* → golden-master (đã có) + adapter cho C2 (không vỡ downstream) + e2e.
- *Over-engineering* → chỉ tổng quát hóa khi có node phi-marketing thật (YAGNI); A.2 là bằng chứng, không làm thừa.

### 2.5 Mở khóa gì (business)
- **Tốc độ ra tính năng:** thêm năng lực = thêm node (ngày/tuần), không phải sprint lõi.
- **Mở rộng thị trường:** vượt marketing → CSKH, phân tích tài liệu, trợ lý nội bộ, v.v.
- **Câu chuyện investor:** "một nền tảng agent mở rộng được", không phải một app marketing đơn lẻ.

---

## 3. TRACK B — Autonomous Agent Workforce (L2 + L3 + multi-provider)

### 3.1 L2 — Mỗi node = agent tự chủ
Đổi node contract từ "1 call → 1 output" thành **vòng lặp có công cụ, có giới hạn**: node tự lập kế hoạch nhỏ, gọi tool riêng, tự kiểm/sửa, dừng theo budget. Khuôn mẫu = `atria-brain` thu nhỏ (đã có sẵn để tái dùng).
- **Cần xây:** tầng **tool per-node** (hiện chưa có) + node-agent runtime (loop + budget + tracing) + eval per-node.

### 3.2 L3 — Atria spawn động sub-agent
Atria tạo động sub-agent cho sub-task bất kỳ (kiểu "Task tool" của Claude Code), điều phối chúng phối hợp. Cần **agent runtime** + hàng đợi + hợp nhất kết quả + guardrail đệ quy (chống spawn vô hạn).

### 3.3 P2 — Trừu tượng hóa nhà cung cấp mô hình (`LlmClient`)
Gộp ~14 chỗ gọi LLM rải rác về một interface; hỗ trợ **Claude / GPT / Gemini** → chọn "mô hình tốt nhất cho từng task" (suy luận sâu dùng model mạnh; việc rẻ dùng model rẻ). Cần thêm `@anthropic-ai/sdk` / OpenAI SDK.

### 3.4 Phases & deliverables
| Phase | Việc | Deliverable | Effort (eng-tuần) |
|---|---|---|---|
| B.0 | `LlmClient` provider abstraction (Claude/GPT/Gemini) | Model-agnostic, chọn theo task | 2–3 |
| B.1 | Node-agent runtime (loop+budget+tracing) + tool layer khung | Hạ tầng cho node tự chủ | 3–4 |
| B.2 | Nâng 2–3 node "dễ thắng" thành agent tự chủ (vd research đa vòng, concept tự sửa) | Bằng chứng chất lượng ↑ | 3–5 |
| B.3 | Eval harness + cost guardrail (budget/agent, model-tiering, caching) | Kiểm soát chất lượng + chi phí | 2–3 |
| B.4 | L3 dynamic spawner (giới hạn đệ quy, orchestration) | Multi-agent phối hợp | 4–6 |
| B.5 | Observability/tracing UI + an toàn | Vận hành + niềm tin | 2–3 |
| **Tổng B** | | | **~16–24 eng-tuần** (làm dần) |

### 3.5 Kinh tế đơn vị (điểm mấu chốt với investor)
- L1 (hiện tại): rẻ — Gemini Flash + context caching (~75% off prefix). Vài phần nghìn USD/lượt.
- L2/L3: **nhân chi phí** (mỗi node giờ nhiều call). **Phải** có: budget/deadline per agent (đã có mẫu ở brain), **model-tiering** (model rẻ cho việc dễ), caching, và trần token/lượt. → giữ biên lợi nhuận.

### 3.6 Rủi ro & giảm thiểu
- *Chi phí token bùng nổ* → guardrail + tiering + caching (B.3) là bắt buộc, không phải tùy chọn.
- *Chất lượng khó đo* → eval harness (B.3) trước khi mở rộng.
- *Độ phức tạp/độ trễ* → giữ vòng lặp có giới hạn (như brain: budget 45s, MAX_ROUNDS 3).
- *Khóa nhà cung cấp* → P2 (B.0) mở đa provider.

### 3.7 Mở khóa gì (business)
- Chất lượng cao hơn, tự động hơn, tự sửa lỗi → "AI workforce" thật sự.
- Khác biệt cạnh tranh sâu (khó sao chép) — moat công nghệ.

---

## 4. Roadmap tổng & cột mốc

```
Giai đoạn 0 (đã xong): L1 general-first assistant — DEMO-READY ✅
  └─ brain, planner, gates, cost ledger, memory, publish, caching

Giai đoạn 1 — TRACK A (~2 tháng, 1–2 eng): Composable Platform
  A.0 golden-master ✅ → A.1 data-driven select → A.2 node SDK + node mẫu
  → A.3 WorkflowProposal → A.4 TaskSpec → A.5 docs/eval
  ► Cột mốc: "thêm 1 năng lực phi-marketing trong 1 ngày, không đụng lõi"

Giai đoạn 2 — TRACK B (~4–6 tháng, 2–3 eng, làm dần): Autonomous Workforce
  B.0 provider abstraction → B.1 node-agent runtime → B.2 nâng 2–3 node
  → B.3 eval + cost guardrail → B.4 dynamic spawner → B.5 observability
  ► Cột mốc: "1 node tự nghiên cứu nhiều vòng + tự sửa, chi phí trong ngân sách"
```

**Ước lượng tổng:** A ~2 tháng; B ~4–6 tháng làm dần song song sau khi A xong nền.

---

## 5. Đội ngũ & tuyển dụng

| Vai trò | Seniority | Kỹ năng | Phụ trách | Khi nào |
|---|---|---|---|---|
| **Agent Infrastructure Engineer** | Senior | TypeScript, LLM orchestration, hệ phân tán, thiết kế API/schema | Planner data-driven (A.1), node SDK, `LlmClient` (B.0), node-agent runtime (B.1), dynamic spawner (B.4) | Ngay — lõi cả A & B |
| **AI/LLM Engineer** | Mid–Senior | Prompt/agent design, function-calling, evals, chọn mô hình, guardrail | Node phi-marketing (A.2), nâng node tự chủ (B.2), eval + cost guardrail (B.3) | Ngay (A.2) → nặng ở B |
| **Full-stack / Frontend** | Mid–Senior | React/TS, UX cho **người dùng non-tech**, dashboard | Flow-card UX, duyệt/gate UX, observability UI (B.5) | Song song |
| **DevOps / Platform** | Mid | Docker, CI/CD, monitoring chi phí, scaling | Deploy, giám sát token/chi phí, hạ tầng | Part-time → full khi lên B |
| **Product / QA** | Mid | Eval, test, thu thập phản hồi non-tech user | Định nghĩa "đúng/tốt", regression, feedback loop | Song song |

**Đội tối thiểu để chạy A→B:** 1 Agent-Infra (senior) + 1 AI/LLM + 1 Full-stack (+ Product/QA part-time). Lên B thì thêm 1 eng + DevOps.

---

## 6. KPI / cột mốc đo lường (cho investor)

- **Track A:** thời gian thêm 1 năng lực mới (mục tiêu: từ "sprint lõi" → "1 ngày/1 node"); số loại task ngoài marketing phục vụ được.
- **Track B:** chất lượng đầu ra (eval pass rate) trước/sau khi node thành agent tự chủ; **chi phí trung bình/lượt** giữ trong ngân sách khi chất lượng tăng.
- **Chung:** chi phí token/người dùng hoạt động; tỷ lệ hoàn tất tác vụ không cần can thiệp; retention của non-tech user.

---

## 7. Câu hỏi mở (cần quyết khi khởi động)
1. `WorkflowProposal` (C2) làm hợp đồng vĩnh viễn ngay, hay giữ adapter tới khi có nguồn proposal thứ 2? (YAGNI)
2. Node phi-marketing đầu tiên để chứng minh drop-in: **summarize / translate / doc-analyze**?
3. Provider ưu tiên cho B.0: Claude trước (suy luận) hay đa provider ngay?
4. Ngân sách token trần/lượt cho L2/L3 là bao nhiêu (định nghĩa "đơn vị kinh tế chấp nhận được")?
