// LinkedIn adapter — personal feed image post. Ported from the n8n LinkedIn
// branch. Uses the FREE consumer path (/v2/assets + /v2/ugcPosts, w_member_social
// scope) — NOT the versioned /rest/* Community Management API (needs legal-entity
// verification). 3-step: registerUpload → PUT binary to uploadUrl → ugcPosts.
// GOTCHA: the created post URN comes back in the `x-restli-id` RESPONSE HEADER,
// not the body.
import { withRetry } from '../lib/retry.ts';
import { getActiveToken, getTokenMeta } from '../tokens/service.ts';
import { getPublisherAppCred } from '../db/repos/agent-credential-repo.ts';
import { env } from '../config/env.ts';
import { assetStore } from '../assets/store.ts';
import type { SocialAdapter, PublishInput, PublishResult } from './types.ts';
import type { AssetType } from '../../prisma/generated/prisma/client.ts';

const ok = (url: string, platformPostId: string | null = null): PublishResult => ({ platform: 'linkedin', ok: true, url, error: null, platformPostId });
const fail = (msg: string): PublishResult => ({
  platform: 'linkedin',
  ok: false,
  url: null,
  error: ('LinkedIn: ' + msg).slice(0, 300),
});

const ownerUrn = async (ownerId: string): Promise<string> => {
  const meta = await getTokenMeta(ownerId, 'linkedin');
  // OAuth token meta → paste-token vault field → env (DAIS default).
  const raw = (meta?.personId as string) || (await getPublisherAppCred(ownerId, 'linkedin_author_urn')) || env.MKT_LINKEDIN_PERSON_ID;
  if (!raw) throw new Error('LinkedIn person id missing');
  // Accept a full urn (urn:li:person:… entered on the form) or a bare member id.
  return raw.startsWith('urn:') ? raw : `urn:li:person:${raw}`;
};

export const linkedinAdapter: SocialAdapter = {
  platform: 'linkedin',
  supports: ['image', 'text'] as AssetType[],
  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const token = await getActiveToken(input.ownerId, 'linkedin');
      const owner = await ownerUrn(input.ownerId);
      const authHeader = { Authorization: `Bearer ${token}` };

      // Text-only post (Fix D): a ugcPost with shareMediaCategory NONE — no registerUpload/binary.
      if (input.assetType === 'text') {
        const res = await withRetry(
          () => fetch('https://api.linkedin.com/v2/ugcPosts', {
            method: 'POST',
            headers: { ...authHeader, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
            body: JSON.stringify({
              author: owner,
              lifecycleState: 'PUBLISHED',
              specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: input.body }, shareMediaCategory: 'NONE' } },
              visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
            }),
          }),
          { label: 'li_post_text' },
        );
        const turn = res.headers.get('x-restli-id') ?? '';
        if (!res.ok || !turn) { const b = await res.text(); return fail(`ugcPost(text) failed: ${res.status} ${b.slice(0, 120)}`); }
        return ok(`https://www.linkedin.com/feed/update/${turn}`, turn);
      }

      const ref = input.assets[0];
      if (!ref) return fail('no asset for image post');

      // 1) registerUpload → uploadUrl + asset URN
      const regRes = await withRetry(
        () =>
          fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
            method: 'POST',
            headers: { ...authHeader, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
            body: JSON.stringify({
              registerUploadRequest: {
                recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
                owner,
                serviceRelationships: [
                  { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
                ],
              },
            }),
          }),
        { label: 'li_register' },
      );
      const reg = (await regRes.json()) as any;
      const uploadUrl =
        reg?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
      const assetUrn = reg?.value?.asset;
      if (!uploadUrl || !assetUrn) return fail(`registerUpload failed: ${JSON.stringify(reg).slice(0, 150)}`);

      // 2) PUT binary to uploadUrl (Bearer only)
      const { bytes, contentType } = await assetStore.fetchBinary(ref);
      const put = await withRetry(
        () =>
          fetch(uploadUrl, {
            method: 'PUT',
            headers: { ...authHeader, 'Content-Type': contentType },
            body: new Uint8Array(bytes),
          }),
        { label: 'li_upload' },
      );
      if (!put.ok) return fail(`binary upload failed: ${put.status}`);

      // 3) create ugcPost — post URN in x-restli-id header
      const postRes = await withRetry(
        () =>
          fetch('https://api.linkedin.com/v2/ugcPosts', {
            method: 'POST',
            headers: { ...authHeader, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
            body: JSON.stringify({
              author: owner,
              lifecycleState: 'PUBLISHED',
              specificContent: {
                'com.linkedin.ugc.ShareContent': {
                  shareCommentary: { text: input.body },
                  shareMediaCategory: 'IMAGE',
                  media: [{ status: 'READY', media: assetUrn }],
                },
              },
              visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
            }),
          }),
        { label: 'li_post' },
      );
      const urn = postRes.headers.get('x-restli-id') ?? '';
      if (!postRes.ok || !urn) {
        const body = await postRes.text();
        return fail(`ugcPost failed: ${postRes.status} ${body.slice(0, 120)}`);
      }
      return ok(`https://www.linkedin.com/feed/update/${urn}`, urn);
    } catch (e) {
      return fail(String(e instanceof Error ? e.message : e));
    }
  },
};
