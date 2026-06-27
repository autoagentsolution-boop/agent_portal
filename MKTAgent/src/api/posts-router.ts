// Posts router — the review gate. List/read posts, approve (review→ready) and
// reject (review→rework). Transitions are atomic + status-guarded so a stale UI
// gets 409 instead of clobbering a post the scheduler already claimed.
import { Router } from 'express';
import { ok, fail, parseOr422, asyncHandler } from './http.ts';
import { listPostsQuery, approvePostBody, rejectPostBody } from './schemas.ts';
import { toPostDto, toPostDetailDto } from './mappers.ts';
import {
  listPosts,
  getPostWithCampaign,
  approveReview,
  rejectReview,
} from '../db/repos/post-repo.ts';

export const postsRouter: Router = Router();

postsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parseOr422(res, listPostsQuery, req.query);
    if (!q) return;
    const rows = await listPosts(q);
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    ok(res, page.map(toPostDto), {
      count: page.length,
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    });
  }),
);

postsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const post = await getPostWithCampaign(req.params.id);
    if (!post) return fail(res, 404, 'post_not_found');
    ok(res, toPostDetailDto(post));
  }),
);

postsRouter.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, approvePostBody, req.body ?? {});
    if (!body) return;
    const updated = await approveReview(req.params.id, body.scheduledAt ?? new Date());
    if (!updated) return fail(res, 409, 'not_in_review', 'post is not in review state');
    ok(res, toPostDto(updated));
  }),
);

postsRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, rejectPostBody, req.body ?? {});
    if (!body) return;
    const updated = await rejectReview(req.params.id, body.feedback);
    if (!updated) return fail(res, 409, 'not_in_review', 'post is not in review state');
    ok(res, toPostDto(updated));
  }),
);
