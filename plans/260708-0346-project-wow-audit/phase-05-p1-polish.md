# Phase 05 — P1 / P2 polish batch

**Priority:** P1–P2 · **Status:** planned. Do after the P0 bugs (phase-01/02) + decisions.

## P1
1. **Stale agent labels** [D] — infographic/storyboard/video are `implStatus:'stub'` in the
   registry but fully LIVE (real image/Veo gen) → Command Center / node UI renders them dimmed
   or "stub", UNDERselling. Flip to `'live'`.
   - Site: `MKTAgent/src/orchestration/registry/*` (grep `implStatus`, `'stub'`).
   - Verify: those nodes render as live/clickable; the 4 vision agents stay display-only.
2. **Auto-publish default ON waives the gate** [B] — cleanly-postable posts skip the approval
   gate by default. DECISION (see plan.md #3): keep ON for demo, or gate. If gate: default the
   auto-publish flag OFF or make it an explicit per-post/per-campaign toggle.
   - Site: publish path / `runtimePublishFn` (`workflow-executor.ts:398-416`), approval-policy.
3. **Cron flags default off** [B/C] — `ENABLE_SCHEDULER_CRON`, `ENABLE_REAPER_CRON`, `LEADS_CRON`
   default `false` (`env.ts:19,56`). Ensure the DEMO `.env` enables them; verify in the running
   deployment (gitignored — user must check). Without these: no scheduled publish, no reaper,
   no leads sweep. [ACTION: user confirms .env]
4. **Materialize silently drops failed slots** [A] — calendar slots that fail to plan are skipped
   without surfacing → post count < requested. Surface partial failures (toast/log + count).
   - Site: campaign-materializer.

## P2
5. **No-LLM fallback leaks VN seeds** [A] — when `GEMINI_API_KEY` absent, the deterministic
   fallback emits hardcoded Vietnamese clarification seeds regardless of user language.
   Guard: only use language-neutral seeds, or gate on detected language.
6. **Usage row missing on no-metadata call** [D] — a real LLM call that returns no
   `usageMetadata` records a zero/no row → slight undercount. Record a best-effort row or log.
7. **Skip-video fresh-goal stale-snapshot edge** [B] — a fresh-goal run can read a stale asset
   snapshot for the media-skip decision. Low impact; re-read snapshot at decision time.

## Todo
- [ ] P1-1 flip implStatus to 'live' (verify UI)
- [ ] P1-2 auto-publish default (after decision)
- [ ] P1-3 confirm demo .env cron flags [user]
- [ ] P1-4 surface materialize partial failures
- [ ] P2-5/6/7 as time permits
- [ ] tsc backend + web green after each

## Success criteria
- Live media agents no longer show as "stub".
- Cron behavior matches demo expectations (flags confirmed).
- No silent slot loss; language-correct fallback.
