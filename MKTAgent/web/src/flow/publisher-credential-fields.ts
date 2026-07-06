// Per-platform credential fields for the paste-a-token path (the ADVANCED fallback when the
// one-click OAuth Connect isn't set up). Keys MUST match the backend allowlist
// (agent-router.ts, publisher agent).
//
// Split into `required` (the minimum to publish: the access token + the ONE identity id the
// adapter needs to target the right page/account) and `advanced` (app/client id+secret — only
// needed if this workspace owns the platform app and wants OAuth refresh). Non-tech users
// never see `advanced` unless they expand it.
export interface PublisherCredentialField {
  key: string;
  label: string;
  hint?: string;
}

export interface PublisherCredentialFields {
  required: PublisherCredentialField[];
  advanced: PublisherCredentialField[];
}

export const publisherCredentialFields: Record<string, PublisherCredentialFields> = {
  facebook: {
    required: [
      { key: 'facebook_access_token', label: 'Page access token' },
      { key: 'facebook_page_id', label: 'Page ID', hint: 'The Facebook Page you publish to.' },
    ],
    advanced: [
      { key: 'facebook_app_id', label: 'App ID' },
      { key: 'facebook_app_secret', label: 'App secret' },
    ],
  },
  instagram: {
    required: [
      { key: 'instagram_access_token', label: 'Access token' },
      { key: 'instagram_business_account_id', label: 'Instagram account ID', hint: 'Your IG business/creator account id.' },
    ],
    advanced: [
      { key: 'instagram_app_id', label: 'App ID' },
      { key: 'instagram_app_secret', label: 'App secret' },
    ],
  },
  threads: {
    required: [{ key: 'threads_access_token', label: 'Access token' }],
    advanced: [
      { key: 'threads_app_id', label: 'App ID' },
      { key: 'threads_app_secret', label: 'App secret' },
    ],
  },
  linkedin: {
    required: [
      { key: 'linkedin_access_token', label: 'Access token' },
      { key: 'linkedin_author_urn', label: 'Member ID', hint: 'Your LinkedIn member id (or full urn:li:person:… ).' },
    ],
    advanced: [
      { key: 'linkedin_client_id', label: 'Client ID' },
      { key: 'linkedin_client_secret', label: 'Client secret' },
    ],
  },
  x: {
    required: [{ key: 'x_access_token', label: 'Access token' }],
    advanced: [
      { key: 'x_refresh_token', label: 'Refresh token', hint: 'Paste this so the token auto-renews. Needs Client ID/secret set. Re-save the access token after adding it.' },
      { key: 'x_client_id', label: 'Client ID', hint: 'For the OAuth Connect flow + auto-refresh.' },
      { key: 'x_client_secret', label: 'Client secret' },
    ],
  },
};
