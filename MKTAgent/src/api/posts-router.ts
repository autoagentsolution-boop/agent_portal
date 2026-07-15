// Posts router — the review gate. List/read posts, approve (review→ready) and
// reject (review→rework). Transitions are atomic + status-guarded so a stale UI
// gets 409 instead of clobbering a post the scheduler already claimed.
import { Router } from 'express';
import { ok, fail, parseOr422, asyncHandler } from './http.ts';
import {
  listPostsQuery,
  approvePostBody,
  rejectPostBody,
  refinePostBody,
  editCopyBody,
  selectVariantBody,
  createPostBody,
  createPostFromAgentBody,
  updatePostBody,
  collectorBody,
  type CreatePostBody,
} from './schemas.ts';
import { recordCommentSources } from '../leads/sources/comment-watch.ts';
import { checkPostLinks } from '../leads/sources/post-liveness.ts';

// How long a lead collector watches a post before it expires (bounds polling overhead).
const COLLECTOR_TTL_DAYS = 30;
import { toPostDto, toPostDetailDto } from './mappers.ts';
import { listArtifacts, updateArtifactData } from '../orchestration/executor/artifact-store.ts';
import { checkPostability } from '../social/postability.ts';
import { publishAssetType } from '../scheduler/resolve-input.ts';
import { resolveConnectionStates } from './connection-state.ts';
import { publishPostStatus } from '../events/bus.ts';
import { generateForPost, refineForPost } from '../copygen/service.ts';
import { publishPostNow } from '../scheduler/tick.ts';
import { getCampaign } from '../db/repos/campaign-repo.ts';
import { cloneTemplateRun, grantAutonomy } from '../db/repos/workflow-run-repo.ts';
import { estimatePostCost } from '../orchestration/master/campaign-grant.ts';
import { issueGrantToken, verifyGrantToken } from './autonomy-grant-token.ts';
import { logRun } from '../db/client.ts';
import { requirementAnalyzer } from '../orchestration/master/requirement-analyzer.ts';
import { goalToBrief, evaluateBriefClarification } from '../orchestration/master/goal-to-brief.ts';
import {
  listPosts,
  getPostWithCampaign,
  getPostForOwner,
  approveReview,
  rejectReview,
  createPostForOwner,
  updatePost,
  updatePostFields,
  editPostCopy,
  deletePost,
} from '../db/repos/post-repo.ts';
import type { Campaign, Post } from '../../prisma/generated/prisma/client.ts';
import { Prisma } from '../../prisma/generated/prisma/client.ts';

export const postsRouter: Router = Router();

// Create a Post under a campaign, cloning the campaign's flow template into an executable
// instance run when one is attached (flow-as-template), and inheriting the campaign's
// platforms/language when the brief omits them. Shared by the manual create (POST /) and
// the agent-authored create (POST /from-agent) so both stay in lock-step. An explicit body
// value always wins over the inherited campaign default (per-post override).
const buildPostUnderCampaign = async (
  campaign: Campaign,
  body: Omit<CreatePostBody, 'campaignId'>,
  ownerId: string,
): Promise<Post> => {
  let runId: string | null = null;
  if (campaign.flowId) {
    const instance = await cloneTemplateRun(campaign.flowId, ownerId, {
      product: campaign.product,
      angle: campaign.angle,
      brandVoice: campaign.brandVoice,
      language: campaign.language,
      productDetails: campaign.brandContext,
      platforms: campaign.platforms,
    });
    // A missing/deleted template just means no runnable instance — the post still exists
    // (legacy copy-gen path) rather than failing the create.
    runId = instance?.id ?? null;
  }
  return createPostForOwner({
    ...body,
    campaignId: campaign.id,
    platforms: body.platforms ?? campaign.platforms ?? undefined,
    language: body.language ?? campaign.language ?? undefined,
    ownerId,
    runId,
  });
};

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
// Flow-as-template: when the campaign is attached to a flow, clone that template into a
// fresh instance run and link it (post.runId) — the post is the executable unit. A
// campaign with no flow keeps the legacy copy-gen path (no runId).
postsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, createPostBody, req.body ?? {});
    if (!body) return;
    const { campaignId, ...brief } = body;
    const campaign = await getCampaign(campaignId, req.userId!);
    if (!campaign) return fail(res, 404, 'campaign_not_found');

    const post = await buildPostUnderCampaign(campaign, brief, req.userId!);
    res.status(201);
    ok(res, toPostDto(post));
  }),
);

// Agent-authored create (item 3): the user describes the post in free text; the Master
// Agent's requirement analyzer extracts the brief fields so the user never hand-fills the
// form. The post lands under THIS campaign (no fork) in `brief` status — the board form is
// still available to tweak anything the agent left thin. `filled` names the fields the
// agent populated so the UI can confirm what it captured. Analysis never blocks the create:
// a thin extraction still yields a brief the user completes on the board.
postsRouter.post(
  '/from-agent',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, createPostFromAgentBody, req.body ?? {});
    if (!body) return;
    const campaign = await getCampaign(body.campaignId, req.userId!);
    if (!campaign) return fail(res, 404, 'campaign_not_found');

    const goal = await requirementAnalyzer.analyze(body.message, req.userId!);

    // First call (no answers): gate on missing high-impact brief fields. If the agent
    // can't fill them from the message AND the campaign doesn't supply them, ASK — return
    // questions instead of creating a generic post. The modal collects answers and re-posts.
    if (!body.answers) {
      const questions = evaluateBriefClarification(goal, campaign);
      if (questions.length > 0 && questions.some((q) => q.required)) {
        res.status(200);
        return ok(res, { questions });
      }
    }

    const { brief, filled } = goalToBrief(goal, body.answers ?? {});
    let post = await buildPostUnderCampaign(campaign, brief, req.userId!);
    // Link the chosen product library entry (feedback #4). Mirrors the manual brief's create-then-set;
    // the FK grounds copy + image/video on THIS product regardless of the campaign default.
    if (body.productKnowledgeId) post = await updatePost(post.id, { productKnowledge: { connect: { id: body.productKnowledgeId } } });
    res.status(201);
    ok(res, { post: toPostDto(post), filled });
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

// Publish review (item 3): per-platform readiness for THIS post. For each target, report
// whether the platform's adapter can post ITS asset type — the per-platform assetType map
// wins, else the post default (item 5) — AND whether it's connected. So the publish step is
// an informed compatible-vs-blocked check instead of an opaque approve button. Read-only, no
// network. A platform publishes only when BOTH hold (asset supported + connection live).
postsRouter.get(
  '/:id/postability',
  asyncHandler(async (req, res) => {
    const post = await getPostForOwner(req.params.id, req.userId!);
    if (!post) return fail(res, 404, 'post_not_found');
    const conn = await resolveConnectionStates(req.userId!);
    const platforms = post.platforms.map((platform) => {
      const assetType = publishAssetType(post, platform);
      const [r] = checkPostability([platform], assetType);
      const c = conn(platform);
      const willPublish = r!.supported && c.state === 'connected';
      const reason = !r!.supported
        ? r!.reason
        : c.state !== 'connected'
          ? `${platform} connection ${c.state.replace('_', ' ')}`
          : null;
      return {
        platform,
        assetType,
        assetSupported: r!.supported,
        supportedAssetTypes: r!.supportedAssetTypes,
        connectionState: c.state,
        willPublish,
        reason,
      };
    });
    ok(res, {
      assetType: post.assetType,
      platforms,
      publishable: platforms.filter((p) => p.willPublish).map((p) => p.platform),
      blocked: platforms.filter((p) => !p.willPublish).map((p) => ({ platform: p.platform, reason: p.reason })),
    });
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
    // platformAssets is a nullable Json column: an explicit null clears the per-platform map,
    // which Prisma expresses as JsonNull (not SQL null). productKnowledgeId is a nullable FK
    // scalar: set it directly (a string links the library entry, null unlinks it). We set the
    // SCALAR, not a nested relation write — updatePostFields runs via updateMany, which rejects
    // relation operations (connect/disconnect). Unchecked input is what exposes the FK scalar.
    const { platformAssets, productKnowledgeId, ...rest } = body;
    const data: Prisma.PostUncheckedUpdateInput = {
      ...rest,
      ...(platformAssets !== undefined ? { platformAssets: platformAssets === null ? Prisma.JsonNull : platformAssets } : {}),
      ...(productKnowledgeId !== undefined ? { productKnowledgeId } : {}),
    };
    const updated = await updatePostFields(req.params.id, req.userId!, data);
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

// Manual copy-gen trigger (T8) — UI "Generate" button. brief|rework → review on
// success, without waiting for the cron. Shares the copy-gen advisory lock so it
// can't double-run with the cron (lock held → 409 busy).
postsRouter.post(
  '/:id/generate',
  asyncHandler(async (req, res) => {
    if (!(await getPostForOwner(req.params.id, req.userId!)))
      return fail(res, 404, 'post_not_found');
    const r = await generateForPost(req.params.id, req.userId!);
    if (r.reason === 'lock_held')
      return fail(res, 409, 'copygen_busy', 'copy-gen is already running; retry shortly');
    if (r.reason === 'not_generatable')
      return fail(res, 409, 'not_generatable', 'post must be in brief or rework state');
    if (r.reason === 'not_found') return fail(res, 404, 'post_not_found');
    if (r.status === 'retry')
      return fail(res, 502, 'copygen_failed', r.error?.slice(0, 300) ?? 'generation failed');
    if (r.status !== 'review') return fail(res, 500, 'copygen_error');
    // Success → return the now-review post.
    const post = await getPostForOwner(req.params.id, req.userId!);
    ok(res, post ? toPostDto(post) : { id: req.params.id, status: 'review' });
  }),
);

// Text-refine trigger — apply a targeted instruction to existing copy (review|ready →
// review) via the LLM, preserving the audit trail (no raw hand-edit). Shares the
// copy-gen advisory lock (held → 409 busy).
postsRouter.post(
  '/:id/refine',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, refinePostBody, req.body ?? {});
    if (!body) return;
    if (!(await getPostForOwner(req.params.id, req.userId!))) return fail(res, 404, 'post_not_found');
    const r = await refineForPost(req.params.id, req.userId!, body.instruction);
    if (r.reason === 'lock_held') return fail(res, 409, 'copygen_busy', 'copy-gen is already running; retry shortly');
    if (r.reason === 'not_refinable') return fail(res, 409, 'not_refinable', 'post must be in review or ready state');
    if (r.reason === 'no_copy') return fail(res, 409, 'no_copy', 'post has no copy to refine yet');
    if (r.reason === 'not_found') return fail(res, 404, 'post_not_found');
    if (r.status === 'retry') return fail(res, 502, 'copygen_failed', r.error?.slice(0, 300) ?? 'refine failed');
    if (r.status !== 'review') return fail(res, 500, 'copygen_error');
    const post = await getPostForOwner(req.params.id, req.userId!);
    // refineForPost only writes post.copy — but the workflow view renders the run's content_concept
    // artifact, so without this the refined/translated copy never surfaces (feedback #1). Mirror
    // /select-variant: push the new copy onto the concept artifact so a reload shows the change.
    if (post?.runId && post.copy) {
      const arts = await listArtifacts(post.runId);
      const concept = arts.find((a) => a.type === 'content_concept');
      if (concept) {
        const data = (concept.data as Record<string, unknown>) ?? {};
        await updateArtifactData(concept.id, req.userId!, 'content_concept', { ...data, copy: post.copy }).catch(() => {});
      }
    }
    ok(res, post ? toPostDto(post) : { id: req.params.id, status: 'review' });
  }),
);

// Activate / stop a post's lead collector (§01.4). Sets the comment-capture keyword; on an
// ALREADY-PUBLISHED post it also backfills the comment watch sources from the live URLs so an
// existing post starts collecting immediately (recordCommentSources normally runs at publish time,
// but these posts were published before a keyword was set). keyword=null stops + clears the collector.
postsRouter.post(
  '/:id/collector',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, collectorBody, req.body ?? {});
    if (!body) return;
    const post = await getPostForOwner(req.params.id, req.userId!);
    if (!post) return fail(res, 404, 'post_not_found');
    if (body.keyword) {
      // Activate/extend: set (or refresh) the keyword + a fresh expiry so the collector isn't
      // polled forever. Re-calling this "extends" the window. Clear any prior post_deleted status.
      const expiresAt = new Date(Date.now() + COLLECTOR_TTL_DAYS * 24 * 60 * 60 * 1000);
      await updatePostFields(post.id, req.userId!, { leadCaptureKeyword: body.keyword, leadCollectorExpiresAt: expiresAt, leadCollectorStatus: null });
      // Backfill watch sources from the already-published URLs (no-op if not yet published).
      const withKeyword = await getPostForOwner(post.id, req.userId!);
      if (withKeyword && post.postUrls) await recordCommentSources(withKeyword, post.postUrls as Record<string, string>);
    } else {
      // Stop collecting: clear keyword + sources + expiry + any 'post_deleted' status.
      await updatePostFields(post.id, req.userId!, { leadCaptureKeyword: null, commentSourceIds: Prisma.JsonNull, leadCollectorStatus: null, leadCollectorExpiresAt: null });
    }
    const final = await getPostForOwner(post.id, req.userId!);
    ok(res, toPostDto(final!));
  }),
);

// Check whether each of a published post's platform links still EXISTS on-platform (the user may
// delete a post after testing). One post can have many platform links; this reports alive/dead per
// platform and self-heals — a dead WATCHED source is dropped, and if none remain the collector is
// marked post_deleted. On-demand (a real API call per platform); reuses the collector's gone signal.
postsRouter.get(
  '/:id/link-status',
  asyncHandler(async (req, res) => {
    const post = await getPostForOwner(req.params.id, req.userId!);
    if (!post) return fail(res, 404, 'post_not_found');
    ok(res, { links: await checkPostLinks(post, req.userId!) });
  }),
);

// Manual copy edit — the user hand-edits the generated copy directly (no LLM). Lands the
// post back at `review` for re-approval. Distinct from /refine (LLM instruction); this is
// a plain overwrite so a typo fix costs no tokens. Guarded to review|ready.
postsRouter.post(
  '/:id/edit-copy',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, editCopyBody, req.body ?? {});
    if (!body) return;
    if (!(await getPostForOwner(req.params.id, req.userId!))) return fail(res, 404, 'post_not_found');
    const post = await editPostCopy(req.params.id, req.userId!, body);
    if (!post) return fail(res, 409, 'not_editable', 'post copy can only be edited in review or ready state');
    // Same as /refine: editPostCopy only writes post.copy, but the workflow view renders the
    // run's content_concept artifact — without this the hand-edit appears to silently revert
    // on the next reload. Mirror the new copy onto the concept artifact.
    if (post.runId && post.copy) {
      const arts = await listArtifacts(post.runId);
      const concept = arts.find((a) => a.type === 'content_concept');
      if (concept) {
        const data = (concept.data as Record<string, unknown>) ?? {};
        await updateArtifactData(concept.id, req.userId!, 'content_concept', { ...data, copy: post.copy }).catch(() => {});
      }
    }
    publishPostStatus(req.userId!, { postId: post.id, status: 'review', campaignId: post.campaignId });
    ok(res, toPostDto(post));
  }),
);

// Concept selection: pick one of the 3-5 versions concept_writer generated. Reads them from
// the run's content_concept artifact, sets post.copy = versions[index] (→ review), and persists
// the chosen index back onto the artifact so a reload reflects the pick. Editable-state only.
postsRouter.post(
  '/:id/select-variant',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, selectVariantBody, req.body ?? {});
    if (!body) return;
    const post = await getPostForOwner(req.params.id, req.userId!);
    if (!post) return fail(res, 404, 'post_not_found');
    if (!post.runId) return fail(res, 409, 'no_versions', 'this post has no workflow versions to choose from');
    const arts = await listArtifacts(post.runId);
    const concept = arts.find((a) => a.type === 'content_concept');
    const data = concept?.data as
      | { variants?: Array<{ body: string; threads: string; x: string }>; [k: string]: unknown }
      | undefined;
    const chosen = data?.variants?.[body.index];
    if (!chosen) return fail(res, 422, 'invalid_version', `no version at index ${body.index}`);
    const updated = await editPostCopy(post.id, req.userId!, chosen);
    if (!updated) return fail(res, 409, 'not_editable', 'versions can only be chosen before publishing');
    if (concept) {
      await updateArtifactData(concept.id, req.userId!, 'content_concept', { ...data, copy: chosen, chosen: body.index }).catch(() => {});
    }
    publishPostStatus(req.userId!, { postId: post.id, status: 'review', campaignId: post.campaignId });
    ok(res, toPostDto(updated));
  }),
);

// Manual publish trigger (T8) — UI "Publish now" button. ready → posting → fan-out
// NOW instead of waiting for the scheduler cron. Owner-scoped atomic claim is the
// race guard; coexists with the cron (first to claim wins). ⚠ This performs a REAL
// social publish — the user invokes it deliberately after reviewing.
postsRouter.post(
  '/:id/publish-now',
  asyncHandler(async (req, res) => {
    if (!(await getPostForOwner(req.params.id, req.userId!)))
      return fail(res, 404, 'post_not_found');
    const r = await publishPostNow(req.params.id, req.userId!);
    if (r.reason === 'not_found') return fail(res, 404, 'post_not_found');
    if (r.reason === 'not_publishable')
      return fail(res, 409, 'not_publishable', 'post must be in ready state');
    // Outcome (posted/partial/error) already persisted + emitted by processPost.
    const post = await getPostForOwner(req.params.id, req.userId!);
    ok(res, post ? toPostDto(post) : { id: req.params.id, status: r.status });
  }),
);

postsRouter.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, approvePostBody, req.body ?? {});
    if (!body) return;
    // 404 first (not found / cross-tenant → no existence leak), then 409 for state.
    const current = await getPostForOwner(req.params.id, req.userId!);
    if (!current) return fail(res, 404, 'post_not_found');
    const updated = await approveReview(req.params.id, req.userId!, body.scheduledAt ?? new Date());
    if (updated) {
      publishPostStatus(req.userId!, { postId: updated.id, status: updated.status, campaignId: updated.campaignId });
      return ok(res, toPostDto(updated));
    }
    // Idempotent: a flow post's concept step auto-approves review→ready, so a stale card can
    // fire Approve on a post that already moved on. If it's already at/past approval, treat
    // this as a no-op success (returns the fresh DTO → the card self-corrects) rather than a
    // dead-end 409. Only a truly pre-review post (brief/rework) has nothing to approve.
    if (current.status !== 'brief' && current.status !== 'rework') return ok(res, toPostDto(current));
    return fail(res, 409, 'not_in_review', 'post is not in review state');
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

// Per-post autonomy grant (only for a campaign-plan post that has a backing run). Two-step, mirroring
// the campaign grant: Step 1 (no token) returns THIS post's cost estimate + a confirmation token WITHOUT
// granting; Step 2 (echo token) flips the run to 'atria' so the autonomy runner auto-prepares it (runs
// pre-steps, then parks at review). Nothing publishes here — the scheduler publishes after approval.
postsRouter.post(
  '/:id/grant-autonomy',
  asyncHandler(async (req, res) => {
    const post = await getPostForOwner(req.params.id, req.userId!);
    if (!post) return fail(res, 404, 'post_not_found');
    if (!post.runId) return fail(res, 409, 'post_has_no_run');
    if (!post.campaignId) return fail(res, 409, 'not_a_campaign_post', 'per-post grant is only for campaign-plan posts');
    const body = (req.body ?? {}) as { confirmationToken?: unknown; scheduleConfirmed?: unknown };

    const estimate = await estimatePostCost(post.runId, req.userId!);
    // Step 1 — no valid token: surface the cost up front + issue the token, DO NOT grant.
    if (!verifyGrantToken(post.runId, req.userId!, body.confirmationToken)) {
      return ok(res, {
        postId: post.id,
        pendingConfirmation: true,
        confirmationToken: issueGrantToken(post.runId, req.userId!),
        estimate,
      });
    }

    // Step 2 — token verified: grant this one run. null = not in a grantable state (already running/posted).
    const scheduleConfirmed = body.scheduleConfirmed === true;
    const granted = await grantAutonomy(post.runId, req.userId!, scheduleConfirmed);
    if (!granted) return fail(res, 409, 'post_not_grantable', 'the post is already running or finished');
    await logRun('info', 'atria_post_grant', { postId: post.id, runId: post.runId, scheduleConfirmed }, req.userId!);
    ok(res, { postId: post.id, granted: true, scheduleConfirmed, estimate });
  }),
);
