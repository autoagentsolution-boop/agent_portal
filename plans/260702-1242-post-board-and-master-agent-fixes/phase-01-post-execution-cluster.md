# Phase 01 — Post-execution cluster (items 5, 6, 7)

**Priority:** HIGHEST (this is what makes the demo board look dead)
**Status:** DONE 2026-07-02

## Outcome
- Item 5: `POST /posts` inherits `campaign.platforms`/`language` when brief omits them; explicit body wins. Verified 5/5 (`src/api/verify-post-platform-inherit.ts`) vs rebuilt container.
- Item 6: legacy "Generate copy" hidden for flow posts (`post.runId`) — DAG Execute is the single run affordance.
- Item 7: `ConnectionRequired` block added to `PostWorkflowView`; `needs_connection` no longer swallowed.
- ⚠ KEY: backend runs in Docker `mktagent-app-1` (NO bind-mount) — host edits require `docker compose up -d --build --force-recreate app`. Stale container caused a false HTTP failure until rebuild. tsc + web build clean; template-instance 22/22 still green.
- New regression guard: `src/api/verify-post-platform-inherit.ts` (auth = `Authorization: Bearer`, not cookie).

## Context
brief1.png: new post under a flow-attached campaign has **Target platforms all unchecked** even though the flow goal was FB+IG.
brief2.png: clicking Generate leaves the DAG node dots at ○ pending — user's red box.
Item 7: "Execute" button appears to do nothing.

These three are ONE story: the post board has two disjoint execution engines that don't talk, plus a swallowed gate.

## Root causes (verified in code)

### Item 5 — platforms not inherited
`posts-router.ts` `POST /` → `createPostForOwner({...body, ownerId, runId})`. Body has no platforms (manual create), and the fn only sets platforms when `args.platforms` present. The `concept_writer` auto-materialize path DOES set `goal.platforms`, but the manual/clone path does not inherit `campaign.platforms`. So a post created under a FB+IG campaign starts with `[]`.

### Item 6 — Generate ≠ DAG advance
`PostCard.tsx:190` "Generate copy" → `api.generate(post.id)` → legacy copy-gen state machine (`brief→review`). The DAG (`PostWorkflowView`) only advances when its own **Execute** calls `api.executeRun(runId)` → workflow-executor. Two engines. The post board shows BOTH ("Generate copy" button AND the "Workflow · 5 steps" DAG), so the user hits Generate and the DAG (correctly) does nothing.

### Item 7 — swallowed needs_connection
`post-workflow-view.tsx` execute():
```
const r = await api.executeRun(run.id);
if (!r.ok) {...}
setRun(r.data); notify('Workflow executing…');
```
When resolver returns `needs_connection`, `respondRun` returns 200 with `run.status='needs_connection'` + `requiredActions`. `PostWorkflowView` has NO `ConnectionRequired` block (unlike `SavedFlowDetail:204`). So status flips to needs_connection, `canExecute` recomputes false, button vanishes, no connect card → "does nothing". FB/IG unconnected (item 5's `[]` platforms actually MASK this — with `[]` the resolver has no targets and returns `resolved`, so the run proceeds but... with no platforms publisher has nothing). Once item 5 is fixed, the gate becomes visible → item 7 fix is mandatory.

## Requirements
1. New post under a flow campaign inherits `campaign.platforms` (+ language, assetType sensible defaults) so the brief shows FB+IG ticked.
2. The post board's DAG is the single source of execution truth. "Generate copy" and the DAG must not present two conflicting "run" affordances for a flow-attached post.
3. `PostWorkflowView` handles `needs_connection` with a `ConnectionRequired` card (reuse existing component) + surfaces `requiredActions`.

## Design decisions
- **Item 6 resolution (KISS):** for a post WITH `runId` (flow-attached), the DAG's **Execute** is the canonical run. Hide/disable the legacy "Generate copy" button when `post.runId` is set — the concept_writer node inside the DAG does copy-gen. For run-less posts (manual, no flow) keep the legacy Generate. This avoids reimplementing either engine (DRY) and removes the conflicting affordance.
  - Verify: `PostCard` already conditionally renders `<PostWorkflowView>` only when `post.runId`. Gate `canGenerate` on `!post.runId`.
- **Item 5:** inherit in `posts-router.ts` POST / — read `campaign.platforms`/`campaign.language` and pass to `createPostForOwner` when body omits them. Body still wins if provided (manual override).
- **Item 7:** lift the `ConnectionRequired` block + `requiredActions` handling from `saved-flow-detail.tsx:156-206` into `post-workflow-view.tsx`. `WorkflowRunDto` already carries `requiredActions` (mappers.ts:30). `canExecute` must include `needs_connection && requiredActions.length===0` (same as saved-flow-detail:161).

## Related code files
- MODIFY `MKTAgent/src/api/posts-router.ts` — POST / inherit campaign.platforms/language (item 5)
- MODIFY `MKTAgent/web/src/components/post-workflow-view.tsx` — add ConnectionRequired + requiredActions (item 7); status hint already has needs_connection
- MODIFY `MKTAgent/web/src/components/PostCard.tsx` — gate legacy Generate on `!post.runId` (item 6)
- READ `MKTAgent/web/src/components/connection-required.tsx` — reuse
- READ `MKTAgent/web/src/components/saved-flow-detail.tsx` — pattern source

## Implementation steps
1. **Item 5** — in `posts-router.ts` POST /, after `getCampaign`, compute:
   ```ts
   const platforms = body.platforms ?? (campaign.platforms as SocialPlatform[] | null) ?? undefined;
   const language = body.language ?? campaign.language ?? undefined;
   ```
   Pass into `createPostForOwner`. (Confirm campaign row exposes platforms/language — campaign-repo.)
2. **Item 7** — in `post-workflow-view.tsx`:
   - import `ConnectionRequired`.
   - add `const requiredActions = run.requiredActions ?? [];`
   - `canExecute` = `planned | failed | (needs_connection && requiredActions.length===0)`.
   - render `{run.status==='needs_connection' && requiredActions.length>0 && <ConnectionRequired actions={requiredActions} busy={busy} onContinue={()=>void execute()} />}`.
   - execute() already `setRun(r.data)` — the needs_connection response lands and card shows.
   - Need `onOpenConnections`? ConnectionRequired uses connectUrl links; check its props vs saved-flow-detail usage.
3. **Item 6** — in `PostCard.tsx`: `const canGenerate = (s==='brief'||s==='rework') && !post.runId;`. Add a hint under the DAG for flow posts ("Copy is generated by the Concept Writer step — click Execute"). Keep Generate visible only for run-less posts.
4. `cd MKTAgent && npx tsc --noEmit && npm --prefix web run build` (or the repo's build script).

## Todo
- [ ] Item 5: campaign platform/language inheritance on POST /posts
- [ ] Item 7: ConnectionRequired in PostWorkflowView
- [ ] Item 6: gate legacy Generate on !post.runId + guidance hint
- [ ] tsc + web build clean
- [ ] Manual e2e: create post under FB+IG flow campaign → platforms ticked → Execute → connect card if unconnected → after connect, nodes light up

## Success criteria
- New post shows campaign's platforms pre-ticked.
- Flow-attached post has ONE run affordance (Execute); no dead "Generate copy".
- Execute on an unconnected platform shows the connect card, not silence.
- After connecting (or in DRY/safe with connection), node dots animate ○→◐→●.

## Risks
- Hiding "Generate copy" for flow posts may confuse users mid-migration who created posts before this. Mitigation: the guidance hint. Low risk — DAG is clearly the newer surface.
- ConnectionRequired's props may differ from what PostWorkflowView can supply (no onOpenConnections there). Check signature; pass a no-op or wire through PostCard's notify if needed.
