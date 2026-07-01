// Per-agent credential/setup config for the real flow nodes. Keyed by the CANONICAL
// registry agent id (snake_case: concept_writer, video, publisher …) — the same id the
// DAG carries on WorkflowNode.agentId and the backend allowlist enforces. The old static
// demo used kebab ids (concept-writer/voice-video); those are retired.
//
// SINGLE SOURCE OF TRUTH: the backend credentialAllowlist (src/api/agent-router.ts) must
// list the SAME agentId → key set. If you add a field here, add it there too, or the PUT
// route returns 422 credential_key_not_allowed.
export interface CredentialField {
  key: string;
  label: string;
  help: string;
}

// Human-readable title per agent id, for the panel header when a node is clicked.
export const AGENT_TITLES: Record<string, string> = {
  ideation: 'Ideation',
  strategy: 'Strategy',
  content_search: 'Find Content',
  concept_writer: 'Write Concept',
  infographic: 'Create Infographic',
  storyboard: 'Storyboard',
  video: 'Voiceover Video',
  publisher: 'Publish',
};

export const agentTitle = (agentId: string): string =>
  AGENT_TITLES[agentId] ?? agentId.replace(/_/g, ' ');

// Non-secret setup hints shown even for agents without encrypted fields.
export const credentialNeeds: Record<string, string[]> = {
  content_search: ['Optional: source URLs, audience notes, niche examples'],
  concept_writer: ['Campaign language + tone + angle'],
  infographic: ['Brand visual references'],
  storyboard: ['Video Farm storyboard pipeline access'],
  video: ['Video generation + voice/music provider access'],
  publisher: ['Connected social OAuth tokens', 'Drive media file IDs', 'Safe/Live publish confirmation'],
};

// Encrypted credential inputs per agent. Keys MUST match the backend allowlist.
export const credentialFields: Record<string, CredentialField[]> = {
  concept_writer: [
    { key: 'gemini_api_key', label: 'Gemini API key', help: 'Used by copy/concept generation. Stored encrypted; never shown again.' },
  ],
  infographic: [
    { key: 'design_provider_key', label: 'Design provider API key', help: 'Provider key for design/image generation.' },
    { key: 'design_client_id', label: 'Design client ID', help: 'Optional if the design provider uses OAuth/app credentials.' },
    { key: 'design_client_secret', label: 'Design client secret', help: 'Optional app secret. Store only if this workspace owns the provider app.' },
  ],
  storyboard: [
    { key: 'storyboard_provider_key', label: 'Storyboard provider key', help: 'Future bridge to the storyboard pipeline.' },
  ],
  video: [
    { key: 'video_provider_key', label: 'Video provider API key', help: 'Video model/provider access.' },
    { key: 'video_client_id', label: 'Video client ID', help: 'Optional if the video provider uses OAuth/app credentials.' },
    { key: 'video_client_secret', label: 'Video client secret', help: 'Optional app secret. Store only if this workspace owns the provider app.' },
    { key: 'tts_music_provider_key', label: 'TTS / music provider key', help: 'Voiceover and music generation access.' },
  ],
  publisher: [
    { key: 'google_client_id', label: 'Google client ID', help: 'For Drive/Gmail/YouTube app access when using workspace-owned Google OAuth.' },
    { key: 'google_client_secret', label: 'Google client secret', help: 'Google OAuth app secret. Stored encrypted; never shown again.' },
    { key: 'google_refresh_token', label: 'Google refresh token', help: 'Long-lived Google token for Drive/Gmail/YouTube operations.' },
    { key: 'facebook_app_id', label: 'Facebook app ID', help: 'Meta app ID for OAuth/content publishing setup.' },
    { key: 'facebook_app_secret', label: 'Facebook app secret', help: 'Meta app secret. Store only for workspace-owned apps.' },
    { key: 'facebook_page_id', label: 'Facebook page ID', help: 'Target Page ID for Facebook publishing.' },
    { key: 'facebook_access_token', label: 'Facebook page access token', help: 'Page access token. Prefer OAuth connect flow for production.' },
    { key: 'instagram_app_id', label: 'Instagram app ID', help: 'Meta/Instagram app ID for publishing setup.' },
    { key: 'instagram_app_secret', label: 'Instagram app secret', help: 'Meta app secret. Store only for workspace-owned apps.' },
    { key: 'instagram_business_account_id', label: 'Instagram business account ID', help: 'Target IG Business account/user ID.' },
    { key: 'instagram_access_token', label: 'Instagram access token', help: 'IG publishing token. Prefer OAuth connect flow for production.' },
    { key: 'threads_app_id', label: 'Threads app ID', help: 'Threads API app ID.' },
    { key: 'threads_app_secret', label: 'Threads app secret', help: 'Threads API app secret.' },
    { key: 'threads_access_token', label: 'Threads access token', help: 'Threads publishing token.' },
    { key: 'linkedin_client_id', label: 'LinkedIn client ID', help: 'LinkedIn OAuth app client ID.' },
    { key: 'linkedin_client_secret', label: 'LinkedIn client secret', help: 'LinkedIn OAuth app secret.' },
    { key: 'linkedin_access_token', label: 'LinkedIn access token', help: 'LinkedIn member/page access token.' },
    { key: 'linkedin_author_urn', label: 'LinkedIn author URN', help: 'Target person or organization URN.' },
    { key: 'x_client_id', label: 'X client ID', help: 'X OAuth app client ID.' },
    { key: 'x_client_secret', label: 'X client secret', help: 'X OAuth app secret if configured as confidential client.' },
    { key: 'x_access_token', label: 'X access token', help: 'X posting token.' },
    { key: 'x_refresh_token', label: 'X refresh token', help: 'X refresh token for token renewal.' },
  ],
};

// Does this agent expose any setup surface at all? (Live/internal agents like ideation
// have neither needs nor fields — clicking their node shows only the artifact output.)
export const hasCredentialSetup = (agentId: string): boolean =>
  (credentialNeeds[agentId]?.length ?? 0) > 0 || (credentialFields[agentId]?.length ?? 0) > 0;
