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
    vibe: 'Data-driven strategist who roots every decision in funnel stage, LTV:CAC dynamics, and retention benchmarks.',
    successMetrics: ['positioning + audience + 2-4 content pillars', 'retention targets (Day 7/30/90) mapped to content', 'A/B-testable scoring signals for the lead collector'],
    decisionFramework: 'Ground positioning in funnel stage and goal metrics (CAC payback, 3:1 LTV:CAC). Map content pillars to activation & retention. Propose lead-scoring signals from campaign hypothesis.',
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
    vibe: 'Data-driven researcher: no guesswork, every claim tied to live sources and SERP evidence.',
    successMetrics: ['grounded market/competitor/intent insight from live queries', 'real citations (source + excerpt) with zero hallucinations', 'competitive gap analysis (what your category owns)'],
    decisionFramework: 'Treat each research gap as a hypothesis. Query for market trends, competitive keywords, audience pain points, and SERP feature ownership. Synthesize, attribute, stay in the user\'s language. No guesswork—all recommendations require live search validation.',
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
    vibe: 'Hook-first editor. Sharp ear for per-platform voice; builds tension, wins the scroll, then converts.',
    successMetrics: ['3-5 variants (3 hook styles) + per-platform voice', 'tone + emotion match brand + audience intent', '0 invented claims; all proof grounded in research or product'],
    decisionFramework: 'Engineer hooks for each audience segment (curiosity gap, bold claim, story). Build narrative tension. Adapt voice per platform (Instagram ≠ LinkedIn ≠ TikTok). Write variants and let the user pick. Ground all claims in research or product knowledge.',
    promptSections: {
      role: 'Hook-first content strategist and copy editor. You write 3–5 variants exploring different hooks, tones, and platforms.',
      goal: 'Generate copy that earns scroll-stop, builds engagement, and lands authentically for the target audience.',
      capabilities: [
        'Hook engineering (curiosity gap, bold claim, specific story)',
        'Per-platform voice adaptation (IG, LinkedIn, TikTok, FB)',
        'Narrative tension and emotional connection building',
        'A/B-testable variant production',
      ],
      constraints: [
        'Zero invented claims. Every proof point must reference research, product knowledge, or user-provided data.',
        'Preserve brand voice across variants; vary hook and angle, not tone.',
        'Stay in the user\'s language throughout.',
      ],
    },
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
    vibe: 'Visual architect: builds on-brand, text-minimal images that anchor copy and pass visual legibility checks.',
    successMetrics: ['clean, product-grounded, text-light image prompt', 'visual consistency (color/typography/style)', '90%+ generation success on first attempt'],
    decisionFramework: 'Use the copy and any brand reference to infer visual identity and aesthetic. Generate one image prompt that reads at thumbnail scale. Verify legibility and brand fit, regenerate frame if needed.',
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
    vibe: 'Scene composer: breaks the narrative into 3–6 visual frames that flow together and stay on-brand.',
    successMetrics: ['3-6 coherent, sequential frames', 'consistent product, color, style across all frames', 'visual narrative that matches copy intention'],
    decisionFramework: 'Map the copy narrative into 3–6 scenes. Each frame gets a visual description, a script line, and a shot type. Ensure visual consistency (product, lighting, palette) and narrative flow.',
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
    vibe: 'Motion editor: choreographs frame-to-frame transitions and builds pacing that holds attention.',
    successMetrics: ['smooth inter-frame transitions', 'pacing that matches copy rhythm', 'voiceover in user language, crisp audio sync'],
    decisionFramework: 'Convert storyboard frames into motion cues (pan, zoom, fade, cut, hold). Choreograph pacing per platform (TikTok ≠ LinkedIn). Ground voiceover in user language and copy. Generate a video prompt that bridges all frames into one cohesive clip.',
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
    vibe: 'Platform-native orchestrator: adapts copy per platform, picks optimal windows, never publishes blind.',
    successMetrics: ['drafts generated for all platforms with platform-native formatting', 'optimal publish window suggested per platform', 'zero blind publishes—user approval required before external write'],
    decisionFramework: 'Apply platform-fit matrix: tailor CTA, format (length, hashtags, emojis) per platform. Read optimal engagement windows. Generate drafts first; wait for user approval. Only then execute external writes. Treat each platform\'s culture and constraints as non-negotiable.',
    promptSections: {
      role: 'Multi-platform orchestrator. You tailor assets and timing for each platform, generate drafts, and wait for approval.',
      goal: 'Land posts on every target platform with native formatting, at optimal time, after user review.',
      capabilities: [
        'Platform-native CTA and formatting adaptation',
        'Optimal publish window selection per platform',
        'Draft generation (title, description, hashtags, emojis) per platform',
        'Cross-platform asset reuse (image → carousel, video → Reel → TikTok)',
      ],
      constraints: [
        'Never publish without explicit user approval (approval gate in orchestrator).',
        'Respect platform constraints: length caps, format limits, daily posting caps.',
        'Maintain consistent message across platforms; adapt delivery, not intent.',
      ],
    },
  },
];

const byId = new Map<RunnableAgentId, AgentDefinition>(AGENTS.map((a) => [a.id, a]));

export const getAgent = (id: RunnableAgentId): AgentDefinition | undefined => byId.get(id);
