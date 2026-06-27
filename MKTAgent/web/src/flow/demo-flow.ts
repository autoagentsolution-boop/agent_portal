// Static Phase-1 AgentPortal demo flow. This is UI-side only: it presents the
// future agent-workflow mental model while mapping today's live runtime to the
// MKTAgent Campaign/Post API. Do not add provider calls here (Stitch/design tools
// are future backend provider adapters behind AgentPortal API, not UI calls).
export type AgentStatus = 'live' | 'existing' | 'planned';
export type AgentMode = 'auto' | 'manual' | 'approval';

export interface FlowAgentNode {
  id: string;
  title: string;
  subtitle: string;
  status: AgentStatus;
  mode: AgentMode;
  output: string;
  currentCapability: string;
}

export interface FlowTemplate {
  id: string;
  title: string;
  promise: string;
  audience: string;
  nodes: FlowAgentNode[];
  requiredInputs: string[];
}

export type DemoMode = 'safe' | 'live';

export const brandingVideoFlow: FlowTemplate = {
  id: 'branding-video-post',
  title: 'Branding / Social Video Post Flow',
  promise: 'Turn one brief into a reviewed social package, then publish manually or by schedule.',
  audience: 'Business, personal brand, course, medical, tech/service, education campaigns',
  requiredInputs: [
    'Product / service / personal topic',
    'Target audience',
    'Brand or persona voice',
    'Output format: image, infographic, carousel, video',
    'Target platforms and publish mode',
  ],
  nodes: [
    {
      id: 'content-research',
      title: 'Find Content',
      subtitle: 'Collect source ideas, references, pain points, proof and hooks.',
      status: 'planned',
      mode: 'auto',
      output: 'Research brief',
      currentCapability: 'Master Agent will gather this context in Phase 2.',
    },
    {
      id: 'concept-writer',
      title: 'Write Concept',
      subtitle: 'Generate copy variants and campaign angle from user context.',
      status: 'live',
      mode: 'approval',
      output: 'Copy bag: body, Threads, X',
      currentCapability: 'Live via MKTAgent copy-gen + review gate.',
    },
    {
      id: 'infographic',
      title: 'Create Infographic',
      subtitle: 'Visualize the concept for tech/service/medical/course formats.',
      status: 'planned',
      mode: 'approval',
      output: 'Infographic image / design spec',
      currentCapability: 'Design provider adapter later (Stitch/Figma/v0/etc behind API).',
    },
    {
      id: 'storyboard',
      title: 'Storyboard',
      subtitle: 'Break the infographic/concept into panels and scene instructions.',
      status: 'existing',
      mode: 'approval',
      output: 'Storyboard JSON',
      currentCapability: 'Video Farm storyboard pipeline exists; not wired to MKTAgent yet.',
    },
    {
      id: 'voice-video',
      title: 'Voiceover Video',
      subtitle: 'Create video, voiceover and music from the storyboard.',
      status: 'existing',
      mode: 'auto',
      output: 'MP4 video artifact',
      currentCapability: 'Video Farm can create videos; AgentPortal node integration pending.',
    },
    {
      id: 'publisher',
      title: 'Publish',
      subtitle: 'Post manually now or let scheduler publish to connected platforms.',
      status: 'live',
      mode: 'manual',
      output: 'Published URLs',
      currentCapability: 'Live via MKTAgent publish-now / scheduler.',
    },
  ],
};

export const demoModeCopy: Record<DemoMode, { title: string; detail: string }> = {
  safe: {
    title: 'Safe Simulation',
    detail: 'Generate/review is live, but live social publishing is blocked from the UI to avoid accidental Meta posts.',
  },
  live: {
    title: 'Live Publish',
    detail: 'Publish-now is enabled and will call connected social platforms. Use only for one controlled demo post.',
  },
};
