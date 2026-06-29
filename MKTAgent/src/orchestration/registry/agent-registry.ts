// The Agent Registry (brief §2) — the closed menu the planner selects from.
// CRITICAL invariant (brief §2): the Master Agent may ONLY choose agents from
// this registry. No agent is invented at plan time; quality/flow stays controlled.
// Edges are derived (not hardcoded) by matching `produces` → `requires` in the
// planner, so adding an agent here + a runner in Phase 4 extends the system.
import type { AgentDefinition, RunnableAgentId } from './agent-types.ts';

export const AGENTS: AgentDefinition[] = [
  {
    id: 'content_search',
    name: 'Content Search Agent',
    description: 'Gather research, references, pain points and proof for the topic.',
    implStatus: 'stub',
    requires: [],
    optional: [],
    produces: ['research_summary'],
    requiresConnection: false,
    requiresApproval: false,
  },
  {
    id: 'concept_writer',
    name: 'Concept Writing Agent',
    description: 'Generate campaign angle + copy variants (live via copy-gen).',
    implStatus: 'live',
    requires: [],
    optional: ['research_summary'],
    produces: ['content_concept'],
    requiresConnection: false,
    // The copy review is a POST-execution gate on the Post (status=review), not an
    // executor halt — generating copy is internal/cheap, so the node just runs.
    // Only external-write nodes (publisher) halt the run BEFORE executing.
    requiresApproval: false,
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
  },
  {
    id: 'video',
    name: 'Video Agent',
    description: 'Turn the storyboard into a video generation prompt.',
    implStatus: 'stub',
    requires: ['storyboard'],
    optional: [],
    produces: ['video_prompt'],
    requiresConnection: false,
    requiresApproval: false,
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
  },
];

const byId = new Map<RunnableAgentId, AgentDefinition>(AGENTS.map((a) => [a.id, a]));

export const getAgent = (id: RunnableAgentId): AgentDefinition | undefined => byId.get(id);
