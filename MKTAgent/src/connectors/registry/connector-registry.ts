// Connector Registry (§11.4/11.10, MVP) — the single source of truth for which
// platforms the product can connect to, their display metadata, and the capability
// skills each accepts. Relocated here from connections-router so BOTH the read-only
// Connections panel AND the pre-execution Connection Resolver read one config (DRY).
//
// P1 keeps this a thin static table (platform + capabilities). P3 formalizes it into
// a full ConnectorDefinition (authStrategies, actions, requiredInputs, mediaConstraints)
// — additive, so nothing here needs to change shape for that.
import type { SocialPlatform, AssetType } from '../../../prisma/generated/prisma/client.ts';

// A concrete action a connector can perform (§11.4) — the bridge between a capability
// skill (social.post.image) and the runtime call. `assetType` lets the runtime map an
// action to the adapter's `supports[]` check; `requiredInputs` lets it validate before
// spending a network call.
export interface ConnectorAction {
  key: string; // capability skill, e.g. 'social.post.image'
  assetType: AssetType; // the publish asset this action materializes
  requiredInputs: string[]; // PublishInput fields that must be present
}

// Per-platform media limits (§11.4) — advisory metadata the runtime/UI can enforce.
export interface MediaConstraints {
  maxAssets: number; // 1 for single-image/video; up to 10 for a carousel
  bodyMaxChars: number | null; // null = no hard cap (FB/LinkedIn); 480 threads; 280 x
}

export interface ConnectorDefinition {
  platformKey: SocialPlatform;
  displayName: string;
  // Capability skills this platform accepts (mirrors the publisher's social.post.*
  // capabilities, scoped to what each platform supports). The resolver crosses these
  // against the agent's declared capabilities to decide whether a connection is needed.
  capabilities: string[];
  // OAuth auth-strategy key → the existing connect-providers entry (§11.3). Kept as a
  // string ref (not the provider object) so this stays pure data; the runtime/connect
  // router resolves it. All five are 'oauth2' today; the field exists for future SAML/
  // api-key strategies without reshaping the registry.
  authStrategy: 'oauth2';
  // Concrete actions, derived from capabilities. The runtime validates against these.
  actions: ConnectorAction[];
  media: MediaConstraints;
}

// Action templates keyed by capability — every connector that declares a capability
// gets the matching action, so actions stay in lockstep with capabilities (DRY).
const ACTION_FOR: Record<string, Omit<ConnectorAction, 'key'>> = {
  'social.post.image': { assetType: 'image', requiredInputs: ['postId', 'ownerId', 'assets', 'body'] },
  'social.post.video': { assetType: 'video', requiredInputs: ['postId', 'ownerId', 'assets', 'body'] },
  'social.post.carousel': { assetType: 'carousel', requiredInputs: ['postId', 'ownerId', 'assets', 'body'] },
  // Text-only post (Fix D): no media asset required — only the copy body.
  'social.post.text': { assetType: 'text', requiredInputs: ['postId', 'ownerId', 'body'] },
};

const actionsFrom = (caps: string[]): ConnectorAction[] =>
  caps.filter((c) => ACTION_FOR[c]).map((c) => ({ key: c, ...ACTION_FOR[c]! }));

// Raw per-platform config (the source of truth). The full ConnectorDefinition is
// derived from this so capabilities↔actions can never drift.
interface ConnectorSeed {
  platformKey: SocialPlatform;
  displayName: string;
  capabilities: string[];
  media: MediaConstraints;
}

// NOTE: `capabilities` here is the CONNECTION axis — what a platform could publish
// once connected, driving whether a connection is required. It is intentionally
// broader than what the adapters have IMPLEMENTED. The runtime truth of "can we
// publish asset type Y right now" lives in each adapter's `supports` array and is
// read via social/postability.ts. Don't wire asset-type validation off this table.
const SEEDS: ConnectorSeed[] = [
  // 'social.post.text' (Fix D) declared for the platforms whose adapters can post copy-only
  // (FB/X/LinkedIn/Threads). Instagram requires media, so it has no text capability → a text post
  // targeting IG is skipped by postability rather than published.
  { platformKey: 'facebook', displayName: 'Facebook', capabilities: ['social.post.image', 'social.post.video', 'social.post.carousel', 'social.post.text'], media: { maxAssets: 10, bodyMaxChars: null } },
  { platformKey: 'instagram', displayName: 'Instagram', capabilities: ['social.post.image', 'social.post.video', 'social.post.carousel'], media: { maxAssets: 10, bodyMaxChars: 2200 } },
  { platformKey: 'threads', displayName: 'Threads', capabilities: ['social.post.image', 'social.post.video', 'social.post.text'], media: { maxAssets: 1, bodyMaxChars: 480 } },
  { platformKey: 'linkedin', displayName: 'LinkedIn', capabilities: ['social.post.image', 'social.post.video', 'social.post.text'], media: { maxAssets: 1, bodyMaxChars: null } },
  { platformKey: 'x', displayName: 'X', capabilities: ['social.post.image', 'social.post.video', 'social.post.text'], media: { maxAssets: 1, bodyMaxChars: 280 } },
];

// Static config — no per-request cost. Order is the display order in the panel.
export const CONNECTORS: ConnectorDefinition[] = SEEDS.map((s) => ({
  platformKey: s.platformKey,
  displayName: s.displayName,
  capabilities: s.capabilities,
  authStrategy: 'oauth2',
  actions: actionsFrom(s.capabilities),
  media: s.media,
}));

const byKey = new Map<SocialPlatform, ConnectorDefinition>(CONNECTORS.map((c) => [c.platformKey, c]));

export const getConnector = (platformKey: SocialPlatform): ConnectorDefinition | undefined =>
  byKey.get(platformKey);

// Resolve a connector's action by capability key (§11.4). Used by the runtime to map
// an actionKey → assetType + requiredInputs before invoking the adapter.
export const getConnectorAction = (
  platformKey: SocialPlatform,
  actionKey: string,
): ConnectorAction | undefined => byKey.get(platformKey)?.actions.find((a) => a.key === actionKey);

// The OAuth start path for a platform — the existing per-user connect flow
// (/connect/:platform/start). Centralized so the panel and resolver build it identically.
export const connectStartPath = (platformKey: SocialPlatform): string =>
  `/connect/${platformKey}/start`;
