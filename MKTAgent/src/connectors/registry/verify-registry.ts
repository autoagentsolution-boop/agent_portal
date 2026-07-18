// Connector Registry verification — asserts the §11.4 ConnectorDefinition shape:
// all 5 platforms present, capabilities↔actions stay in lockstep (no drift), each
// action maps to a valid assetType + requiredInputs, media constraints are sane, and
// the P1 surface (CONNECTORS capabilities + connectStartPath) is unchanged so the
// resolver/router keep working. Pure, no DB. Run: `npx tsx src/connectors/registry/verify-registry.ts`.
import { CONNECTORS, getConnector, getConnectorAction, connectStartPath } from './connector-registry.ts';
import type { AssetType } from '../../../prisma/generated/prisma/client.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Keyed by the Prisma AssetType enum so it is EXHAUSTIVE BY CONSTRUCTION: adding a member to the
// schema breaks tsc here until it's listed. The previous plain array had gone stale — `text` shipped
// with the asset_type_text migration (20260708140000) and is declared by the registry for
// fb/threads/linkedin/x, but this allowlist still rejected it, so 4 checks had been failing
// unnoticed. Nothing ran the verify scripts together, so nobody saw it.
const ASSET_TYPES: Record<AssetType, true> = { image: true, video: true, carousel: true, text: true };

// All 5 platforms.
check('5 connectors registered', CONNECTORS.length === 5, CONNECTORS.map((c) => c.platformKey));
check('platforms = fb/ig/threads/linkedin/x',
  JSON.stringify(CONNECTORS.map((c) => c.platformKey)) === JSON.stringify(['facebook', 'instagram', 'threads', 'linkedin', 'x']),
  CONNECTORS.map((c) => c.platformKey));

for (const c of CONNECTORS) {
  // Lockstep: one action per capability, same keys, no extras.
  const capSet = JSON.stringify([...c.capabilities].sort());
  const actSet = JSON.stringify(c.actions.map((a) => a.key).sort());
  check(`${c.platformKey}: actions match capabilities (lockstep)`, capSet === actSet, { caps: c.capabilities, actions: c.actions.map((a) => a.key) });
  // Each action well-formed.
  for (const a of c.actions) {
    check(`${c.platformKey}.${a.key}: valid assetType`, ASSET_TYPES[a.assetType] === true, a.assetType);
    check(`${c.platformKey}.${a.key}: has requiredInputs`, a.requiredInputs.length > 0 && a.requiredInputs.includes('ownerId'), a.requiredInputs);
  }
  // Media sanity.
  check(`${c.platformKey}: maxAssets >= 1`, c.media.maxAssets >= 1, c.media);
  check(`${c.platformKey}: authStrategy oauth2`, c.authStrategy === 'oauth2', c.authStrategy);
}

// Carousel only where maxAssets > 1 (fb/ig).
const carouselPlatforms = CONNECTORS.filter((c) => c.capabilities.includes('social.post.carousel')).map((c) => c.platformKey);
check('carousel only on fb + ig', JSON.stringify(carouselPlatforms) === JSON.stringify(['facebook', 'instagram']), carouselPlatforms);

// Lookups.
check('getConnector(facebook) found', getConnector('facebook')?.displayName === 'Facebook');
check('getConnectorAction(facebook, image) found', getConnectorAction('facebook', 'social.post.image')?.assetType === 'image');
check('getConnectorAction(threads, carousel) undefined (unsupported)', getConnectorAction('threads', 'social.post.carousel') === undefined);

// P1 invariant preserved.
check('connectStartPath unchanged', connectStartPath('facebook') === '/connect/facebook/start', connectStartPath('facebook'));

console.log(failures === 0 ? '\nPASS — all connector-registry checks green' : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
