// Per-platform postability (§ per-platform asset type, item 1). The RUNTIME truth
// of "can platform X publish asset type Y right now" is each adapter's `supports`
// array — NOT the connector-registry `capabilities` (which is aspirational and
// drives connection-resolution, a different axis). This module is the single place
// that reads adapter truth, so the publish path (tick) and the pre-publish review
// (item 3 endpoint) can never drift apart.
import { getAdapter } from './index.ts';
import type { SocialPlatform, AssetType } from '../../prisma/generated/prisma/client.ts';

export const supportedAssetTypes = (platform: SocialPlatform): AssetType[] =>
  getAdapter(platform)?.supports ?? [];

export const platformSupportsAsset = (platform: SocialPlatform, assetType: AssetType): boolean =>
  supportedAssetTypes(platform).includes(assetType);

export interface PostabilityRow {
  platform: SocialPlatform;
  assetType: AssetType;
  supported: boolean;
  supportedAssetTypes: AssetType[];
  // Null when supported; a human reason ("cannot post carousel — supports image")
  // when not. Item 3 surfaces this verbatim; item 1 uses it for skip messaging.
  reason: string | null;
}

const reasonFor = (platform: SocialPlatform, assetType: AssetType, supp: AssetType[]): string =>
  supp.length === 0
    ? `${platform} has no publishable asset types yet`
    : `${platform} cannot post ${assetType} — supports ${supp.join(', ')}`;

// Report, per target platform, whether it can publish this asset type. Pure and
// network-free so both the publish fan-out and the review endpoint call it.
export const checkPostability = (
  platforms: SocialPlatform[],
  assetType: AssetType,
): PostabilityRow[] =>
  platforms.map((platform) => {
    const supp = supportedAssetTypes(platform);
    const supported = supp.includes(assetType);
    return {
      platform,
      assetType,
      supported,
      supportedAssetTypes: supp,
      reason: supported ? null : reasonFor(platform, assetType, supp),
    };
  });

// Split targets into what will actually be published vs what gets skipped, with a
// reason per skipped platform. The tick fans out only to `supported`.
export const partitionByPostability = (
  platforms: SocialPlatform[],
  assetType: AssetType,
): { supported: SocialPlatform[]; skipped: PostabilityRow[] } => {
  const rows = checkPostability(platforms, assetType);
  return {
    supported: rows.filter((r) => r.supported).map((r) => r.platform),
    skipped: rows.filter((r) => !r.supported),
  };
};
