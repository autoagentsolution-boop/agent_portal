# Master Agent Chat + Active Flows Polish

## Status
- In progress

## Goal
Make AgentPortal feel like a true Master Agent product: default page is a ChatGPT/Claude-style setup workspace with chat history; second page manages active flows.

## Scope
1. Backend intake provider
   - Add optional Gemini-backed parser using `GEMINI_API_KEY`.
   - Keep deterministic fallback for local/offline/no-cost runs.
   - Return structured setup draft only; never publish.
2. Master Agent page
   - Chat-style historical thread.
   - User enters niche/campaign request.
   - Agent replies with selected flow, locked setup summary, missing gates.
   - Form/edit controls hidden unless user clicks edit.
3. Active Flows page
   - Show campaigns/posts as active flow operations.
   - Agent nodes display only name + status by default.
   - Clicking node reveals detail/credentials/setup requirements.
4. Preserve safety
   - No direct live publish from Master Agent.
   - Existing Safe Simulation guard remains.

## Validation
- `npm --prefix MKTAgent run typecheck`
- `npm --prefix MKTAgent/web run build`

## Risks
- Gemini JSON may fail; fallback must be deterministic.
- No database-backed chat history in this slice; browser session history only.
- Real user-behavior memory/local LLM storage is future work.
