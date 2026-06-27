// Config-as-data resolver (T3 §2). Three-layer inheritance: Post → Campaign →
// User. A null at one layer inherits from the layer above. This is the single
// source of truth for "what language/length/voice does this post generate in" —
// both the prompt builder and (later) the scheduler read from here.
import type { PostWithCampaignOwner } from '../db/repos/post-repo.ts';

export interface ResolvedCopyConfig {
  language: string; // resolved free-form language code/label
  lengthRaw: string; // resolved length keyword/wordcount (may be '')
  // Brand persona — null means PERSONAL account / no brand → persona-free prompt.
  brandVoice: string | null;
  brandContext: string | null;
  brandName: string | null;
}

const firstNonEmpty = (...vals: Array<string | null | undefined>): string | null => {
  for (const v of vals) {
    const t = (v ?? '').trim();
    if (t) return t;
  }
  return null;
};

export function resolveCopyConfig(post: PostWithCampaignOwner): ResolvedCopyConfig {
  const campaign = post.campaign;
  const user = campaign.owner;

  // Language always resolves to a concrete value (user.defaultLanguage is NOT NULL,
  // default 'vi') so copy-gen always knows what to generate.
  const language = firstNonEmpty(post.language, campaign.language, user.defaultLanguage) ?? 'vi';

  const lengthRaw = firstNonEmpty(post.lengthSpec, campaign.defaultLength) ?? '';

  // Brand persona: campaign overrides user. Personal accounts leave both null →
  // null here → prompt builder runs persona-free. brandContext kept distinct from
  // voice (context = facts, voice = tone) and inherits the same way.
  const brandVoice = firstNonEmpty(campaign.brandVoice, user.brandVoice);
  const brandContext = firstNonEmpty(campaign.brandContext, user.brandContext);
  const brandName = firstNonEmpty(user.brandName);

  return { language, lengthRaw, brandVoice, brandContext, brandName };
}
