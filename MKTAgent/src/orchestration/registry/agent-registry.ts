// The Agent Registry (brief §2) — the closed menu the planner selects from.
// CRITICAL invariant (brief §2): the Master Agent may ONLY choose agents from
// this registry. No agent is invented at plan time; quality/flow stays controlled.
// Edges are derived (not hardcoded) by matching `produces` → `requires` in the
// planner, so adding an agent here + a runner in Phase 4 extends the system.
import type { AgentDefinition, RunnableAgentId } from './agent-types.ts';

export const AGENTS: AgentDefinition[] = [
  {
    id: 'ideation',
    name: 'Ideation Agent',
    description: 'Brainstorm campaign directions and pick the strongest angle.',
    implStatus: 'live',
    requires: [],
    optional: ['research_summary'],
    produces: ['campaign_ideas'],
    requiresConnection: false,
    requiresApproval: false,
    emoji: '💡',
    group: 'intelligence',
    vibe: 'A restless idea machine that chases the sharpest angle.',
    successMetrics: ['3-5 distinct directions', 'a decisive, product-grounded pick'],
    decisionFramework: 'Diverge on angles, then converge on the one with the strongest hook for the audience.',
  },
  {
    id: 'strategy',
    name: 'Strategy Agent',
    description: 'Turn the chosen idea into positioning, audience and content pillars.',
    implStatus: 'live',
    requires: ['campaign_ideas'],
    optional: [],
    produces: ['strategy_brief'],
    requiresConnection: false,
    requiresApproval: false,
    emoji: '🧭',
    group: 'intelligence',
    vibe: 'A calm strategist who turns a spark into a defensible plan.',
    successMetrics: ['clear positioning + audience', '2-4 actionable content pillars', 'lead-scoring criteria the collector can use'],
    decisionFramework: 'Anchor every choice to the funnel stage and the audience the goal names; propose scoring signals from the campaign intent.',
  },
  {
    id: 'content_search',
    name: 'Content Search Agent',
    description: 'Research the market, competitors, pain points and proof via live web search.',
    // LIVE (Phase 02 Researcher): Gemini Google-Search grounding — no new provider.
    implStatus: 'live',
    requires: [],
    optional: [],
    produces: ['research_summary'],
    requiresConnection: false,
    requiresApproval: false,
    emoji: '🔎',
    group: 'intelligence',
    vibe: 'A tenacious researcher who cites live sources, never guesses.',
    successMetrics: ['grounded market/competitor insight', 'real citations, not hallucinations'],
    decisionFramework: 'Query the open web for what the product knowledge cannot answer; synthesize, attribute, and stay in the user\'s language.',
  },
  {
    id: 'concept_writer',
    name: 'Concept Writing Agent',
    description: 'Generate campaign angle + copy variants (live via copy-gen).',
    implStatus: 'live',
    requires: [],
    optional: ['research_summary', 'strategy_brief'],
    produces: ['content_concept'],
    requiresConnection: false,
    // The copy review is a POST-execution gate on the Post (status=review), not an
    // executor halt — generating copy is internal/cheap, so the node just runs.
    // Only external-write nodes (publisher) halt the run BEFORE executing.
    requiresApproval: false,
    emoji: '✍️',
    group: 'action',
    // Atria's "Editor": write sample → approve → batch. Maps to concept versions gate.
    vibe: 'An editor with a sharp ear for on-brand voice.',
    successMetrics: ['3-5 copy variants to choose from', 'tone matches the brand voice', 'no invented claims'],
    decisionFramework: 'Write to the strategy pillars and the audience; offer versions, let the user pick the voice.',
  },
  {
    id: 'infographic',
    name: 'Infographic Agent',
    description: 'Produce a visual brief + image prompt from the concept.',
    implStatus: 'stub',
    requires: ['content_concept'],
    optional: [],
    produces: ['infographic_brief'],
    requiresConnection: false,
    requiresApproval: false,
    emoji: '🖼️',
    group: 'action',
    vibe: 'A visual designer who makes one clean, on-brand image.',
    successMetrics: ['a product-grounded, text-free image', 'follows any user reference'],
  },
  {
    id: 'storyboard',
    name: 'Storyboard Agent',
    description: 'Break the concept into scenes + a video script.',
    implStatus: 'stub',
    requires: ['content_concept'],
    optional: [],
    produces: ['storyboard'],
    requiresConnection: false,
    requiresApproval: false,
    emoji: '🎬',
    group: 'action',
    vibe: 'A storyboard artist who keeps every frame on-model.',
    successMetrics: ['3-6 coherent frames', 'consistent product + style across frames'],
  },
  {
    id: 'video',
    name: 'Video Agent',
    description: 'Turn the storyboard into a video generation prompt.',
    implStatus: 'stub',
    requires: ['storyboard'],
    optional: [],
    produces: ['video_prompt'],
    emoji: '🎥',
    group: 'action',
    vibe: 'A motion editor who turns frames into one flowing clip.',
    successMetrics: ['smooth stitched video', 'voiceover in the campaign language'],
    requiresConnection: false,
    // Cost gate: Veo i2v is the most expensive step. Halt BEFORE it so the user reviews the
    // (already-generated) storyboard frames and can re-run/adjust them before spending on
    // video. The executor's approval-halt supports this sequential gate (video, then publisher).
    requiresApproval: true,
  },
  {
    id: 'publisher',
    name: 'Publisher Agent',
    description: 'Publish the post to targeted platforms (live via publish path).',
    implStatus: 'live',
    requires: ['content_concept'],
    optional: ['infographic_brief', 'video_prompt'],
    produces: ['publish_result'],
    requiresConnection: true,
    requiresApproval: true, // external-write gate (brief §11.12)
    // ONE publisher, many platforms: these capability skills are fanned out to the
    // GoalSpec's target platforms by the live publish path (publishTo), not split
    // into per-platform nodes. Per-platform outcomes surface as UI sub-rows.
    capabilities: ['social.post.image', 'social.post.video', 'social.post.carousel'],
    emoji: '📤',
    group: 'action',
    vibe: 'A publisher who ships at the right moment and asks before going live.',
    successMetrics: ['posts land on every targeted platform', 'optimal-time suggestion offered before approval'],
    decisionFramework: 'Suggest the best publishing window per platform/audience, then wait for the user\'s go before any external write.',
  },
];

const byId = new Map<RunnableAgentId, AgentDefinition>(AGENTS.map((a) => [a.id, a]));

export const getAgent = (id: RunnableAgentId): AgentDefinition | undefined => byId.get(id);
