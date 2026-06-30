// Connector Registry (§11.4/11.10, MVP) — the single source of truth for which
// platforms the product can connect to, their display metadata, and the capability
// skills each accepts. Relocated here from connections-router so BOTH the read-only
// Connections panel AND the pre-execution Connection Resolver read one config (DRY).
//
// P1 keeps this a thin static table (platform + capabilities). P3 formalizes it into
// a full ConnectorDefinition (authStrategies, actions, requiredInputs, mediaConstraints)
// — additive, so nothing here needs to change shape for that.
import type { SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

export interface ConnectorDefinition {
  platformKey: SocialPlatform;
  displayName: string;
  // Capability skills this platform accepts (mirrors the publisher's social.post.*
  // capabilities, scoped to what each platform supports). The resolver crosses these
  // against the agent's declared capabilities to decide whether a connection is needed.
  capabilities: string[];
}

// Static config — no per-request cost. Order is the display order in the panel.
export const CONNECTORS: ConnectorDefinition[] = [
  { platformKey: 'facebook', displayName: 'Facebook', capabilities: ['social.post.image', 'social.post.video', 'social.post.carousel'] },
  { platformKey: 'instagram', displayName: 'Instagram', capabilities: ['social.post.image', 'social.post.video', 'social.post.carousel'] },
  { platformKey: 'threads', displayName: 'Threads', capabilities: ['social.post.image', 'social.post.video'] },
  { platformKey: 'linkedin', displayName: 'LinkedIn', capabilities: ['social.post.image', 'social.post.video'] },
  { platformKey: 'x', displayName: 'X', capabilities: ['social.post.image', 'social.post.video'] },
];

const byKey = new Map<SocialPlatform, ConnectorDefinition>(CONNECTORS.map((c) => [c.platformKey, c]));

export const getConnector = (platformKey: SocialPlatform): ConnectorDefinition | undefined =>
  byKey.get(platformKey);

// The OAuth start path for a platform — the existing per-user connect flow
// (/connect/:platform/start). Centralized so the panel and resolver build it identically.
export const connectStartPath = (platformKey: SocialPlatform): string =>
  `/connect/${platformKey}/start`;
