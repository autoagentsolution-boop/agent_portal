// Per-platform credential fields for the OAuth-less Connect form. Keys MUST match the
// backend allowlist (agent-router.ts, publisher agent). Only the access token gates
// the connection state / preflight; app id/secret are optional extras a workspace may
// store when it owns the provider app. The token service resolves <platform>_access_token.
export interface PublisherCredentialField {
  key: string;
  label: string;
  required?: boolean;
}

export const publisherCredentialFields: Record<string, PublisherCredentialField[]> = {
  facebook: [
    { key: 'facebook_access_token', label: 'Page access token', required: true },
    { key: 'facebook_page_id', label: 'Page ID' },
    { key: 'facebook_app_id', label: 'App ID' },
    { key: 'facebook_app_secret', label: 'App secret' },
  ],
  instagram: [
    { key: 'instagram_access_token', label: 'Access token', required: true },
    { key: 'instagram_business_account_id', label: 'Business account ID' },
    { key: 'instagram_app_id', label: 'App ID' },
    { key: 'instagram_app_secret', label: 'App secret' },
  ],
  threads: [
    { key: 'threads_access_token', label: 'Access token', required: true },
    { key: 'threads_app_id', label: 'App ID' },
    { key: 'threads_app_secret', label: 'App secret' },
  ],
  linkedin: [
    { key: 'linkedin_access_token', label: 'Access token', required: true },
    { key: 'linkedin_author_urn', label: 'Author URN' },
    { key: 'linkedin_client_id', label: 'Client ID' },
    { key: 'linkedin_client_secret', label: 'Client secret' },
  ],
  x: [
    { key: 'x_access_token', label: 'Access token', required: true },
    { key: 'x_client_id', label: 'Client ID' },
    { key: 'x_client_secret', label: 'Client secret' },
  ],
};
