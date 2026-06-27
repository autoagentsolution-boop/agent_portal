// Posts router — the review gate. List/read posts, approve (review→ready) and
// reject (review→rework). Transitions are atomic + status-guarded so a stale UI
// gets 409 instead of clobbering a post the scheduler already claimed.
import { Router } from 'express';
import { ok, fail, parseOr422, asyncHandler } from './http.ts';
import {
  listPostsQuery,
  approvePostBody,
  rejectPostBody,
  createPostBody,
  updatePostBody,
} from './schemas.ts';
import { toPostDto, toPostDetailDto } from './mappers.ts';
import { publishPostStatus } from '../events/bus.ts';
import { getCampaign } from '../db/repos/campaign-repo.ts';
import {
  listPosts,
  getPostWithCampaign,
  getPostForOwner,
  approveReview,
  rejectReview,
  createPostForOwner,
  updatePostFields,
  deletePost,
} from '../db/repos/post-repo.ts';

export const postsRouter: Router = Router();

postsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parseOr422(res, listPostsQuery, req.query);
    if (!q) return;
    const rows = await listPosts({ ...q, ownerId: req.userId! });
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    ok(res, page.map(toPostDto), {
      count: page.length,
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    });
  }),
);

// Create a brief. Campaign ownership is verified against the JWT FIRST (404 if the
// campaign isn't the caller's) so ownerId is denormalized from a trusted source,
// never the body. Always starts `brief`; copy-gen will generate + move to review.
postsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, createPostBody, req.body ?? {});
    if (!body) return;
    if (!(await getCampaign(body.campaignId, req.userId!)))
      return fail(res, 404, 'campaign_not_found');
    const post = await createPostForOwner({ ...body, ownerId: req.userId! });
    res.status(201);
    ok(res, toPostDto(post));
  }),
);

postsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const post = await getPostWithCampaign(req.params.id, req.userId!);
    if (!post) return fail(res, 404, 'post_not_found');
    ok(res, toPostDetailDto(post));
  }),
);

// Edit a post's config (asset/targets/schedule). 404-before-409: the scoped probe
// returns 404 for not-found/wrong-tenant first; a null from the state-guarded
// update then means the post is in a scheduler-owned state → 409.
postsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, updatePostBody, req.body ?? {});
    if (!body) return;
    if (!(await getPostForOwner(req.params.id, req.userId!)))
      return fail(res, 404, 'post_not_found');
    const updated = await updatePostFields(req.params.id, req.userId!, body);
    if (!updated)
      return fail(res, 409, 'not_editable', 'post is in a non-editable (scheduler-owned) state');
    ok(res, toPostDto(updated));
  }),
);

// Delete a post. Blocked only while the scheduler holds it (status=posting → 409).
postsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!(await getPostForOwner(req.params.id, req.userId!)))
      return fail(res, 404, 'post_not_found');
    const r = await deletePost(req.params.id, req.userId!);
    if (r === 'locked')
      return fail(res, 409, 'post_in_flight', 'post is being published; cannot delete');
    res.status(204).end();
  }),
);

postsRouter.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, approvePostBody, req.body ?? {});
    if (!body) return;
    // 404 first (not found / cross-tenant → no existence leak), then 409 for state.
    if (!(await getPostForOwner(req.params.id, req.userId!))) return fail(res, 404, 'post_not_found');
    const updated = await approveReview(req.params.id, req.userId!, body.scheduledAt ?? new Date());
    if (!updated) return fail(res, 409, 'not_in_review', 'post is not in review state');
    publishPostStatus(req.userId!, { postId: updated.id, status: updated.status, campaignId: updated.campaignId });
    ok(res, toPostDto(updated));
  }),
);

postsRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, rejectPostBody, req.body ?? {});
    if (!body) return;
    if (!(await getPostForOwner(req.params.id, req.userId!))) return fail(res, 404, 'post_not_found');
    const updated = await rejectReview(req.params.id, req.userId!, body.feedback);
    if (!updated) return fail(res, 409, 'not_in_review', 'post is not in review state');
    publishPostStatus(req.userId!, { postId: updated.id, status: updated.status, campaignId: updated.campaignId });
    ok(res, toPostDto(updated));
  }),
);
