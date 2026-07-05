// Post media uploads (concept gate reference image). Split from posts-router because the
// base64 image body exceeds the global 1mb limit — this router is mounted with its own 20mb
// parser BEFORE the global parser (see server.ts), same pattern as product-knowledge. Any
// non-matching /posts route falls through to the normal postsRouter.
import { Router } from 'express';
import { ok, fail, parseOr422, asyncHandler } from './http.ts';
import { referenceImageBody } from './schemas.ts';
import { toPostDto } from './mappers.ts';
import { saveUploadedImage, SUPPORTED_IMAGE_MIME } from '../assets/save-uploaded-image.ts';
import { getPostForOwner, setPostReferenceImage, attachPostMedia } from '../db/repos/post-repo.ts';
import { publishPostStatus } from '../events/bus.ts';
import { logger } from '../lib/logger.ts';

export const postMediaRouter: Router = Router();

// Upload a reference image for a post (optional, non-blocking — concept gate). Default: store as
// the post's referenceImage → infographic/storyboard generate FROM it (Gemini edit mode). With
// asHero=true (a post with NO media step): the uploaded image becomes the post media directly.
postMediaRouter.post(
  '/:id/reference-image',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, referenceImageBody, req.body ?? {});
    if (!body) return;
    if (!SUPPORTED_IMAGE_MIME.has(body.mimeType.toLowerCase())) {
      return fail(res, 415, 'unsupported_file_type', `${body.mimeType} is not supported — use PNG, JPG, or WebP.`);
    }
    const post = await getPostForOwner(req.params.id, req.userId!);
    if (!post) return fail(res, 404, 'post_not_found');

    let ref: string;
    try {
      ({ ref } = await saveUploadedImage(body.dataB64, body.mimeType));
    } catch (e) {
      logger.warn('reference_image_save_failed', { postId: post.id, error: String(e).slice(0, 200) });
      return fail(res, 400, 'bad_image', String(e instanceof Error ? e.message : e).slice(0, 200));
    }

    const updated = body.asHero
      ? await attachPostMedia(post.id, req.userId!, 'image', ref) // own image = the media, no gen
      : await setPostReferenceImage(post.id, req.userId!, ref); // conditions media generation
    if (!updated) return fail(res, 409, 'not_editable', 'post is in a non-editable (scheduler-owned) state');
    publishPostStatus(req.userId!, { postId: post.id, status: updated.status, campaignId: post.campaignId });
    ok(res, toPostDto(updated));
  }),
);

// Remove the reference image (revert to text-to-image generation).
postMediaRouter.delete(
  '/:id/reference-image',
  asyncHandler(async (req, res) => {
    if (!(await getPostForOwner(req.params.id, req.userId!))) return fail(res, 404, 'post_not_found');
    const updated = await setPostReferenceImage(req.params.id, req.userId!, null);
    if (!updated) return fail(res, 409, 'not_editable', 'post is in a non-editable (scheduler-owned) state');
    ok(res, toPostDto(updated));
  }),
);
