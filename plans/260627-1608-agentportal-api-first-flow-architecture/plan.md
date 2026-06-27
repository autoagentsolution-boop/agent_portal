# AgentPortal API-first Flow Architecture Plan

## Overview

AgentPortal is not only MKTAgent UI. It is an API-first workspace where users create content/social/video workflows by composing agents.

Core idea:

```txt
Workspace / Master Agent
  → collects missing context
  → recommends a flow
  → orchestrates nodes/agents
  → stores artifacts
  → asks user approvals at gates
  → publishes manually or automatically
```

Primary example flow:

```txt
Find Content → Write Concept → Infographic → Storyboard → Voiceover Video → Publish
```

Current MKTAgent is the first fixed flow: copy generation + review + publish. Video Farm becomes future media-agent family.

## Status

| Area | Status | Notes |
|---|---|---|
| MKTAgent backend | Done | Multi-tenant auth, campaign/post CRUD, copy-gen, publish triggers |
| Browser BFF | Done | Opaque session cookie, CORS, no token in browser |
| Test UI scaffold | Done | Vite+React review board in `MKTAgent/web` |
| AgentPortal flow model | Planned | Needs API model: workspace/flow/run/node/artifact |
| Design provider integration | Planned | Stitch should be provider behind API, not product API |
| Video/infographic/storyboard nodes | Planned | Video Farm exists separately; integration pending |

## API-first principle

Any UI/platform must integrate through AgentPortal API, not through a UI-specific implementation.

Supported frontends later:

- Web app
- Mobile app
- Chrome extension
- n8n/Zapier-style automation
- Partner API
- White-label dashboard

Therefore backend must expose stable resources:

```txt
Workspace
FlowTemplate
FlowRun
NodeRun
Artifact
AgentDefinition
ProviderConnection
ApprovalGate
```

## Key decision: Stitch / design MCP

The Stitch MCP command is useful for Claude-assisted design generation, but it must NOT become the product API boundary.

Correct architecture:

```txt
UI / API Client
  → AgentPortal API
    → Design Agent Node
      → DesignProvider adapter
        → Stitch API/MCP now
        → Figma/v0/Canva/custom provider later
```

Reason:

- MCP is a tool/runtime integration detail.
- Product needs provider-agnostic API.
- API keys stay server-side.
- UI should never know Stitch-specific transport or credentials.
- Any future frontend can call the same AgentPortal API.

Security note: do not store provider API keys in repo/docs/plans. Rotate/restrict any key pasted into chat before production use.

## Proposed resource model

### Workspace

Tenant/project context.

Fields:

- ownerId
- name
- accountType: business | personal
- brandVoice
- targetAudience
- defaultLanguage
- connectedPlatforms
- provider settings

### AgentDefinition

Capability catalog item.

Examples:

- Content Research Agent
- Concept Writer Agent
- Infographic Agent
- Storyboard Agent
- Voiceover Video Agent
- Publisher Agent

Fields:

- key
- name
- category
- inputSchema
- outputSchema
- providerRequirements
- costEstimate
- status: live | available | planned | custom-request

### FlowTemplate

Reusable graph.

Examples:

- Branding Social Post Flow
- Personal Thought Leadership Flow
- Course Launch Video Flow
- Medical Explainer Flow

Fields:

- nodes[]
- edges[]
- requiredInputs[]
- approvalGates[]
- demoMode policy

### FlowRun

One execution of a template.

Fields:

- workspaceId
- flowTemplateId
- status
- userBrief
- selectedMode: safe | live
- currentNode
- costSoFar
- createdAt

### NodeRun

Execution state for one node.

Fields:

- flowRunId
- agentKey
- status: pending | running | waiting_approval | done | failed | skipped
- inputArtifactIds[]
- outputArtifactIds[]
- logs summary
- cost
- duration

### Artifact

Node output.

Types:

- research_brief
- concept_copy
- infographic_image
- storyboard_json
- voiceover_audio
- video_mp4
- social_post
- published_url

Fields:

- type
- uri / fileId / JSON payload
- metadata
- createdByNodeRunId
- version

## UI/UX information architecture

### 1. Workspace Dashboard

Purpose: start from user intent, not CRUD.

Sections:

- Master Agent prompt: "What do you want to create?"
- Recommended workflows
- Recent flow runs
- Connected accounts/provider health

### 2. Flow Recommendation Wizard

Master Agent gathers missing info:

- goal
- audience
- product/service
- source content/reference
- format: image / carousel / infographic / video
- platforms
- publish mode: manual / scheduled / auto

Output:

- recommended flow template
- required agents
- missing provider connections
- estimated cost/time

### 3. Flow Canvas / Timeline

Show pipeline as node graph.

Example:

```txt
Input Brief
  ↓
Content Research Agent
  ↓
Concept Writer Agent
  ↓
Infographic Agent
  ↓
Storyboard Agent
  ↓
Voiceover Video Agent
  ↓
Publisher Agent
```

Badges:

- Live
- Existing but not wired
- Planned
- Needs approval
- Auto
- Manual

### 4. Run Detail

Current `MKTAgent/web` review board becomes this panel.

It shows:

- node status timeline
- generated artifacts
- approval gates
- publish controls
- errors/log summary

### 5. Agent Catalog

Users can see/reuse/request agents.

Sections:

- Live agents
- Available integrations
- Planned agents
- Request custom agent

## Demo mode strategy

Need support both investor and customer demo.

| Mode | Behavior | Use |
|---|---|---|
| Safe Simulation | Gemini/design can run, publish is simulated | repeated demos, investor pitch |
| Live Publish | actual platform publish | one controlled DAIS demo |

UI must clearly display active mode.

Live publish needs confirmation:

```txt
This will post to connected social accounts.
Platforms: Facebook, Instagram, LinkedIn
[Cancel] [Publish live]
```

## What is real vs roadmap for demo

| Capability | Demo label | Truth |
|---|---|---|
| Login/session | Live | Done |
| Campaign/post CRUD | Live | Done |
| Content/concept generation | Live | Gemini copy-gen done |
| Publish | Live with caution | Done, external platform risk |
| Flow canvas | Demo UI layer | Not graph runtime yet |
| Infographic Agent | Planned / provider-backed | Not built |
| Storyboard/Video Agent | Existing pipeline, integration pending | Video Farm exists separately |
| Custom agent request | Product vision | Not built |

## Implementation phases

### Phase 1 — Demo-ready UI shell

Goal: represent AgentPortal mental model without backend graph migration.

Work:

- Reframe current UI as Workspace Dashboard + Flow Run detail
- Add Flow Canvas component backed by static template config
- Add Master Agent guidance panel
- Add Demo Mode switch UI
- Add seeded demo flow data
- Keep current MKTAgent API mapping

Success:

- User can demo Workspace → Flow → Run → Generate → Approve → Publish/simulate
- Investor sees agent composition vision
- Customer sees real working path

### Phase 2 — API-first flow model

Goal: backend resources for generic workflows.

Work:

- Add Workspace table/API if needed beyond User
- Add AgentDefinition registry
- Add FlowTemplate/FlowRun/NodeRun/Artifact schema
- Map current Post lifecycle into a FlowRun adapter
- Expose flow APIs via OpenAPI

Success:

- UI no longer hardcodes flow nodes
- Any frontend can render flow from API

### Phase 3 — Provider-agnostic design agent

Goal: integrate Stitch/design generation as server-side provider.

Work:

- Define `DesignProvider` adapter interface
- Add `stitch` provider implementation behind server API
- Store provider keys server-side only
- Design Agent node creates Artifact(type=infographic_image/design_spec)
- Add provider health/error/cost logging

Success:

- UI calls AgentPortal API, not Stitch directly
- provider can be swapped later

### Phase 4 — Video Farm integration

Goal: wire storyboard/video pipeline as nodes.

Work:

- Wrap storyboard-v2 pipeline as AgentDefinition
- Convert outputs to Artifact records
- Add async NodeRun jobs for long-running media
- Add preview/download/publish handoff

Success:

- Full flow can produce video artifact then publish

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Overbuilding graph runtime before demo | slow, high complexity | Phase 1 uses static template config |
| Demo implies fake capabilities | trust loss | badge each node: Live / Planned / Integration pending |
| Provider lock-in to Stitch | hard to swap | provider adapter behind AgentPortal API |
| API key leakage | credential compromise | server-side secrets only, rotate/restrict pasted keys |
| Long-running video jobs via HTTP | timeout/flaky | async NodeRun job model |
| Live publish risk | platform checkpoint | Safe mode default, live mode confirm |

## Immediate next steps

1. Build Phase 1 UI shell on top of current `MKTAgent/web`.
2. Create static flow template config for demo.
3. Add Master Agent guidance panel copy + missing-info checklist.
4. Add Demo Mode switch UI (safe/live).
5. Add visible node badges: Live / Existing Integration / Planned.
6. Later create Phase 2 backend plan before schema migration.

## Open questions

- Demo date and audience priority split: investor-first or customer-first?
- Which style system will be forked tomorrow?
- Should Phase 1 include a mock Agent Catalog page or only canvas/timeline?
- Should Safe Simulation publish update local status or stay visually simulated only?
