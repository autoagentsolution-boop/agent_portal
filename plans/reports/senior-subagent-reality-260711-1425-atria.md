# Atria sub-agent reality check — 260711-1425

**Question:** Does Atria implement Claude-Code-style sub-agents (autonomous agents each running their own tool loop), or are "agent nodes" a prompt-templated single-LLM-call framework that would need re-coding?

**Verdict: FRAMEWORK-ONLY — needs re-coding.** No node is an autonomous agent. There is no Anthropic/Claude SDK. Nothing spawns a sub-agent. There is exactly ONE tool-using loop in the whole system (`atria-brain`), and it is a single agent — it does not spawn sub-agents; the "agents" it plans are deterministic single-call functions.

---

## 1. What an "agent node" IS, mechanically

An "agent node" is **one prompt-templated Gemini `generateContent` call, or a deterministic function** — no loop, no tools, no iteration.

- Registry is **metadata only**: `AgentDefinition` is "the capability menu the rule-based planner selects from… the registry stays a pure data description (testable without execution)" (`registry/agent-types.ts:1-4, 26-59`). `promptSections`/`decisionFramework` are declarative strings assembled into a system-prompt string by `build-agent-prompt.ts:49-66` — NOT an agent loop. (`decisionFramework` isn't even consumed; `promptSections` only feeds `role/goal/capabilities/constraints` text.)
- Each runner in `agent-runners.ts` is a **one-shot** call:
  - `runIdeation` (`agent-runners.ts:408-425`): build one system prompt → `await call(system, prompt, …)` → `safeParse` → return. Same shape for `runStrategy` (428-447), `runCampaignStrategist` (454-485), `runEmailWriter` (767-795).
  - `runConceptWriter` (195-232) / `finalizeConcept` (109-132): materialize a Post + call copy-gen ONCE. Deterministic plumbing.
  - `runResearcher` (239-277): one `runResearch` call. `runInfographic` (555-578): one image gen. `runStoryboard` (582-672): one LLM plan call + a `for` loop over frames that just calls image-gen per frame (a media fan-out, NOT a reasoning loop). `runVideo` (683-751), `runPublisher` (282-318), `runEmailAgent` (800-818): deterministic.
- The executor is a **deterministic topological DAG walker**: `executeNode` calls `runner(ctx)` exactly once (`agent-executor.ts:18-30`); `workflow-executor.ts:253` iterates `for (const planNodeId of validated.order)` in topo order. No node re-plans, re-invokes tools, or iterates on its own output. `RunnableAgentId → fn` map is static (`agent-runners.ts:820-834`).

The word "agent" here = **a node type in a DAG**, not an autonomous actor.

## 2. Does anything spawn a Claude-Code-style sub-agent?

**No.** Evidence:
- `grep @anthropic-ai|anthropic|Agent SDK|subagent|sub-agent|spawnAgent|tool-loop` over `MKTAgent/src` → **No matches**.
- `package.json:17-29` — dependencies are Prisma, Express, googleapis, pg, zod, node-cron. **No Anthropic/Claude SDK.** It's a Gemini app (all LLM calls hit `generativelanguage.googleapis.com`, e.g. `atria-brain.ts:44-45`).
- No node runner instantiates a tool loop, no runner calls another agent as a sub-task. The DAG is the only composition; it's fixed by the planner, walked deterministically.

## 3. Is atria-brain a "real agent"?

**Yes — a real single-agent tool-using loop, but it does NOT spawn sub-agents.**
- `runAtriaBrain` (`atria-brain.ts:90-154`) is a genuine function-calling loop: Gemini with `functionDeclarations`, up to `MAX_ROUNDS = 3` (line 41), echoes model function-calls, dispatches tools, feeds results back (lines 111-148). This is agentic.
- But it is **one agent with 5 tool functions**, not a spawner: `atria-tools.ts:35-94` declares `web_search`, `get_workspace_data`, `recall_memory`, `save_memory`, `propose_workflow`. `dispatchTool` (98-143) each just wraps an existing function (grounded search, data-query, memory repo, requirement-analyzer). None of these tools *is* an agent with its own loop.
- Critically, `propose_workflow` (`atria-tools.ts:125-136`) only **plans** a DAG (`masterAgent.planFromGoal`) and hands the flow card to the approval gate. The nodes it plans are the deterministic one-shot runners from §1. So even the "agentic" brain, when it delegates work, delegates to **non-agentic single-call nodes**.

**Distinction:** atria-brain = "agentic loop with tools" (single agent). It is NOT "spawns sub-agents." The layer that would need sub-agents — the per-node execution — has none.

## 4. What it'd take to realize real per-node autonomous sub-agents

**Reusable as a framework (keep):**
- Registry/planner/DAG: `AgentDefinition` metadata, capability-based planning, topo-ordered executor, gates (`gate: selection|cost|publish`), approval halts, SSE status, cost ledger, artifact store (validate-in/out). This is a solid orchestration substrate.
- The atria-brain loop is a **ready-made template** for a per-node agent loop (Gemini function-calling + rounds + deadline + graceful degrade). It could be lifted and parameterized per node.
- `promptSections`/`decisionFramework` registry data is the natural place to define per-agent personas/tools for real agents (currently under-used — `decisionFramework` is dead data).

**Missing / must be built (re-code the node contract):**
- The node contract is `runner(ctx) → single RunnerOutput` (`agent-runners.ts:81-88`, `agent-executor.ts:25`). To make each node an agent you must replace the one-shot body with a **bounded tool loop per node** (like atria-brain), give each node its **own tool set** (none exist per-node today — tools live only at the brain), and let a node **iterate on / critique its own output** before emitting the artifact.
- No per-node tool registry, no per-node tool dispatcher, no per-node reasoning budget/round tracking. Would need: per-agent `tools[]` in the registry, a generic node-agent runner (loop), and wiring `decisionFramework`/`promptSections` into that loop's system prompt.
- If Claude specifically is wanted: add `@anthropic-ai/sdk` (absent) and a provider abstraction — the memory notes multi-provider LLM is explicitly DEFERRED.

**Effort:** medium. The scaffolding (registry, DAG, gates, cost, artifacts) is reusable; the **node execution body must be re-coded** from one-shot call → autonomous loop, and a per-node tool layer built from scratch. The atria-brain loop is the pattern to copy.

## 5. Bottom line

**Framework-only, needs re-coding — partial at best.** Atria's "agent nodes" are NOT autonomous sub-agents; each is a single prompt-templated Gemini call (or deterministic function) run once by a fixed topological DAG walker. There is no Anthropic/Claude SDK anywhere — it's a Gemini app — and nothing spawns a sub-agent. The ONE genuinely agentic piece is `atria-brain` (a single tool-using function-calling loop, ≤3 rounds), but it is one agent calling 5 wrapper tools, and the workflow it proposes is executed by the very non-agentic one-shot nodes. To get real per-node sub-agents you keep the registry/planner/DAG/gates/cost substrate (genuinely reusable) and the atria-brain loop as a template, but you must re-code the node contract from "one call → one artifact" into "bounded tool loop per node" and build a per-node tool layer that does not exist today. It's a usable scaffold, not a realized capability.

**Status:** DONE
