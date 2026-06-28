# MKTAgent Full Flow UI Polish

## Status
- In progress

## Goal
Polish MKTAgent web UI so demo users can complete the full marketing flow using existing backend APIs.

## Scope
1. Campaign intake: product, angle, brand voice/tone, brand context, language, length, platforms, lead form, posting window/timezone.
2. Post brief: language, length, platforms, asset type, Drive folder/file IDs, schedule.
3. Review gate: reject feedback/rework, approve with schedule, publish safety.
4. Master Agent panel: show real required inputs and missing-flow guidance.

## Implementation
- Reuse existing REST contract; no schema/migration expected.
- Add small UI components under `MKTAgent/web/src/components/`.
- Keep files focused and below context-heavy size where practical.

## Validation
- `npm --prefix MKTAgent run typecheck`
- `npm --prefix MKTAgent/web run build`

## Risks
- Drive picker/upload remains paste-ID based for this slice.
- User default language settings endpoint is out of scope; use campaign/post language fields.

## Security / Ops
- Preserve Safe Simulation publish guard.
- Keep CORS/session-cookie behavior unchanged.
- Avoid logging or rendering secrets.
