# Phase 02 — API message envelope

## Context Links

- Audit §3 (raw identifiers): [`audit-260722-1949-language-localization-gap.md`](../../reports/audit-260722-1949-language-localization-gap.md)
- The two server-authored sentences: `src/orchestration/executor/workflow-executor.ts:366`, node errors surfaced at `web/src/components/run-dag-view.tsx:115`
- Live evidence: F9 (`email_agent: send failed (gmail_not_connected)` shown verbatim) and F14 (`invalid_grant`) in [`test-260722-1744-script4-and-f7-fix.md`](../../reports/test-260722-1744-script4-and-f7-fix.md)

## Overview

**Priority:** P0 — this is the half a frontend-only i18n cannot reach · **Status:** ⬜ not started

Stop the server from authoring sentences. It emits `{code, params}`; the client renders words.

## Key Insights

- **87 sites** interpolate `${r.error.error}` into a toast across 27 files. At 3 of them
  (`content-calendar.tsx:34,39,50`, `instruction-editor.tsx:33,38,43`, `atria-suggestion-cards.tsx:36`)
  the raw code **is** the entire message. `PostCard.tsx:51` additionally appends `JSON.stringify(details)`.
- These are not merely untranslated — they are unreadable in **any** language. `invalid_grant` told the
  user nothing about reconnecting Google. So this phase buys clarity even at 1 language, which is what
  makes it worth doing regardless of how far the rest of the track gets.
- The gate notice at `workflow-executor.ts:366` is composed with `conn.required.map(displayName)` — the
  params are already structured, they are just being flattened into English prose too early.
- Codes already exist and are stable (`gmail_not_connected`, `invalid_grant`, `insufficient_credits`, …).
  This phase does not invent a taxonomy; it *exposes* the one that is already there and gives each entry a
  sentence and a remedy.

## Requirements

**Functional**
- Every API error carries `{ error: string /* code */, params?: Record<string,string|number> }`.
- Every server-originated user-facing notice (SSE node notices, gate copy) carries the same shape.
- The client renders `t('err.' + code, params)`; unknown code → a generic sentence **plus** the raw code
  in small print, so support can still triage.
- Node errors (`wf_node_run.error`) carry a code, not a composed sentence.

**Non-functional**
- Backward compatible: `error` stays a string, so any un-migrated client keeps working.
- No behaviour change to retry/backoff logic keyed on error codes.

## Architecture

```
shared contract:  { error: 'gmail_not_connected', params: { platform: 'Gmail' } }
server:           fail(res, 400, 'gmail_not_connected', { platform })   ← params optional
client:           notify(tError(r.error))  →  t('err.gmail_not_connected', params)
catalog.en.ts:    'err.gmail_not_connected': 'Gmail is not connected. Connect Google to send email.'
                  'err.invalid_grant':      'Your Google connection expired. Reconnect Google to keep sending.'
```

One `tError(err)` helper in `web/src/i18n` centralizes the fallback, so no component decides what to do
with an unknown code. Node errors keep a `code` field alongside the existing human string during
migration; the client prefers `code` and falls back to the string.

## Related Code Files

**Create:** `web/src/i18n/t-error.ts`, `src/lib/user-message.ts` (code+params type, shared shape)
**Modify:** `src/lib/http.ts` (or wherever `fail()` lives) · `src/orchestration/executor/workflow-executor.ts:366` (notice → code+params) · `src/orchestration/executor/agent-runners.ts` (throw codes, not sentences — `email_writer: no recipient…`, `email_agent: send failed (x)`) · `src/email/gmail-send.ts` (already throws codes — keep) · the 27 client files interpolating `r.error.error` · `web/src/components/run-dag-view.tsx:115-116`
**Delete:** none

## Implementation Steps

1. Define `UserMessage = { code: string; params?: Record<string, string | number> }` in `src/lib`.
2. Extend `fail()` to accept optional params and serialize them. Leave the `error` string untouched.
3. Sweep `agent-runners.ts` + executor for **thrown sentences** — convert to codes with params. Keep a
   dev-only English message for logs; the log is not the UI.
4. `workflow-executor.ts:366`: emit `{ code: 'notice.connect_to_publish', params: { platforms } }`.
5. Add `err.*` + `notice.*` keys to `catalog.en.ts`, each with a **remedy clause** — the sentence must say
   what to do next, which is the actual defect in every one of the 87 sites.
6. Replace the 87 interpolations with `tError(r.error)`. Mechanical; do it file by file, not by regex.
7. `PostCard.tsx:51`: drop the `JSON.stringify(details)` from user-facing text; log it instead.

## Todo List

- [ ] `UserMessage` type + `fail()` params support
- [ ] Thrown sentences in runners/executor → codes
- [ ] Publish-gate notice → code + params
- [ ] `err.*` / `notice.*` English catalog entries, each with a remedy
- [ ] `tError()` helper + unknown-code fallback with raw code in small print
- [ ] All 87 interpolation sites migrated
- [ ] `run-dag-view.tsx` renders node errors via code
- [ ] JSON dump removed from `PostCard.tsx:51`

## Success Criteria

- A tenant with a dead Google token sees "Your Google connection expired. Reconnect Google to keep
  sending." — not `invalid_grant`.
- `grep -r 'error.error' web/src` returns nothing outside `t-error.ts`.
- Every code thrown by `src/**` has a catalog entry (asserted in phase 05).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| A code is renamed and the catalog silently drifts | Phase 05 asserts both directions: no orphan codes, no missing entries. |
| Losing diagnostic detail users used to paste into support | Unknown-code fallback still prints the raw code; `details` moves to the log with the runId. |
| 87 sites is a big mechanical diff | Do it per-file with the component's own tests/screens; never a blanket regex — several sites need a *different* code per branch. |

## Security Considerations

- Params are the only thing crossing the boundary — never interpolate raw exception text or stack traces
  into a code's params; that is how internal paths leak to users.
- Keep masking rules intact: a lead's email in params must already be masked by the caller (see
  `maskEmail`), the catalog does not mask.

## Next Steps

Phase 03 consumes this envelope for the act-on tier. Phase 05 turns the two invariants into CI.
