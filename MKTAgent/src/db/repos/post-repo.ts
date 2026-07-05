// Post repository — the scheduler/copy-gen state machine lives on these queries.
// Mirrors the n8n scheduler's "pick due row / claim / write-back" but in SQL.
//
// TENANCY (T2): two classes of query, deliberately split —
//   • Tenant-facing (REST routes): REQUIRE ownerId, scoped via post.ownerId
//     (denormalized flat column). Wrong tenant → null → route 404.
//   • Worker (scheduler/copy-gen cron): UNSCOPED on purpose — a tick processes
//     every owner's due posts. These never reach a user route.
import { prisma } from '../client.ts';
import type { Post, PostStatus, Prisma } from '../../../prisma/generated/prisma/client.ts';

// owner_id is required at create time (denormalized from campaign by the caller).
export type PostCreate = Prisma.PostUncheckedCreateInput;

export const createPost = (data: PostCreate): Promise<Post> => prisma.post.create({ data });

// ── Worker queries (unscoped: all tenants) ───────────────────────────────────

// Copy-gen queue: oldest brief|rework first, across all owners.
export const findCopyGenDue = (): Promise<Post | null> =>
  prisma.post.findFirst({
    where: { status: { in: ['brief', 'rework'] } },
    orderBy: { createdAt: 'asc' },
  });

// Copy-gen needs the parent Campaign (product/angle/leadsForm) AND its owner
// (brand voice/context + default language for the T3 three-layer resolution).
export type PostWithCampaign = Prisma.PostGetPayload<{ include: { campaign: true } }>;
export type PostWithCampaignOwner = Prisma.PostGetPayload<{
  include: { campaign: { include: { owner: true } } };
}>;

export const findCopyGenDueWithCampaign = (): Promise<PostWithCampaignOwner | null> =>
  prisma.post.findFirst({
    where: { status: { in: ['brief', 'rework'] } },
    orderBy: { createdAt: 'asc' },
    include: { campaign: { include: { owner: true } } },
  });

// Scheduler queue: ready + scheduledAt in the past, oldest first (all owners).
export const findPublishDue = (now: Date): Promise<Post | null> =>
  prisma.post.findFirst({
    where: { status: 'ready', scheduledAt: { lte: now } },
    orderBy: { scheduledAt: 'asc' },
  });

// Atomic claim: only transition ready→posting if still ready (guards double-pick
// alongside the advisory lock). Returns count so caller can detect a lost race.
export const claimForPublish = async (id: string): Promise<boolean> => {
  const r = await prisma.post.updateMany({
    where: { id, status: 'ready' },
    data: { status: 'posting' },
  });
  return r.count === 1;
};

// Owner-scoped atomic claim for the manual "publish now" trigger (T8). Same race
// guard as claimForPublish but also asserts ownerId — so the UI button can only
// claim the caller's own post. Coexists with the cron: whichever claims the
// ready→posting transition first wins; the loser sees false (claim_lost).
export const claimForPublishOwned = async (id: string, ownerId: string): Promise<boolean> => {
  const r = await prisma.post.updateMany({
    where: { id, ownerId, status: 'ready' },
    data: { status: 'posting' },
  });
  return r.count === 1;
};

// Worker write-back — keyed by id only (the worker already owns the row it claimed).
export const updatePost = (id: string, data: Prisma.PostUpdateInput): Promise<Post> =>
  prisma.post.update({ where: { id }, data });

export const setStatus = (id: string, status: PostStatus): Promise<Post> =>
  prisma.post.update({ where: { id }, data: { status } });

// ── Tenant-facing queries (scoped by ownerId) ────────────────────────────────

// Scoped read with campaign included. Wrong tenant → null (route → 404).
export const getPostWithCampaign = (
  id: string,
  ownerId: string,
): Promise<PostWithCampaign | null> =>
  prisma.post.findFirst({ where: { id, ownerId }, include: { campaign: true } });

// Cheap scoped existence probe — lets routes return 404 for not-found/wrong-tenant
// BEFORE an atomic transition reports 409 for wrong-state (no existence leak).
export const getPostForOwner = (id: string, ownerId: string): Promise<Post | null> =>
  prisma.post.findFirst({ where: { id, ownerId } });

// The Post an instance run executes (post.runId = run.id). Flow-as-template: the post
// is created BEFORE its run executes, so concept_writer fills THIS post rather than
// creating a new campaign+post. Null when a run has no attached post (legacy path).
export const getPostByRunId = (runId: string): Promise<Post | null> =>
  prisma.post.findFirst({ where: { runId } });

// Scoped fetch with campaign+owner for the manual copy-gen trigger (T8). Mirrors
// findCopyGenDueWithCampaign's include but for ONE owner-scoped post. Null → 404.
export const getPostForCopyGen = (
  id: string,
  ownerId: string,
): Promise<PostWithCampaignOwner | null> =>
  prisma.post.findFirst({
    where: { id, ownerId },
    include: { campaign: { include: { owner: true } } },
  });

// REST list: tenant-scoped + filter + keyset pagination by id. Fetches limit+1
// to compute the next cursor without a second count query.
export interface ListPostsArgs {
  ownerId: string;
  status?: PostStatus;
  campaignId?: string;
  limit: number;
  cursor?: string;
}

export const listPosts = (args: ListPostsArgs): Promise<Post[]> =>
  prisma.post.findMany({
    where: {
      ownerId: args.ownerId,
      ...(args.status ? { status: args.status } : {}),
      ...(args.campaignId ? { campaignId: args.campaignId } : {}),
    },
    orderBy: { id: 'asc' },
    take: args.limit + 1,
    ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
  });

// Atomic, tenant-scoped review-gate transitions. Guard on current status AND
// ownerId (same pattern as claimForPublish) so a stale UI can't approve a post
// that already moved on, and one tenant can't mutate another's post. Returns the
// updated row, or null if the guard didn't match (not in review OR wrong tenant).
export const approveReview = async (
  id: string,
  ownerId: string,
  scheduledAt: Date,
): Promise<Post | null> => {
  const r = await prisma.post.updateMany({
    where: { id, ownerId, status: 'review' },
    data: { status: 'ready', scheduledAt },
  });
  return r.count === 1 ? prisma.post.findFirst({ where: { id, ownerId } }) : null;
};

export const rejectReview = async (
  id: string,
  ownerId: string,
  feedback: string,
): Promise<Post | null> => {
  const r = await prisma.post.updateMany({
    where: { id, ownerId, status: 'review' },
    data: { status: 'rework', feedback },
  });
  return r.count === 1 ? prisma.post.findFirst({ where: { id, ownerId } }) : null;
};

// ── Tenant-facing CRUD (T7) ───────────────────────────────────────────────────

// States in which a user may edit/configure a post. Excludes scheduler-owned
// states (ready/posting/posted/partial) — once approved, the worker owns the row.
const EDITABLE: PostStatus[] = ['brief', 'review', 'rework', 'error'];

// Tenant create: the route has already verified the campaign belongs to ownerId,
// so ownerId is denormalized here (never from the client body). Always starts at
// `brief` — copy-gen picks it up; the client cannot inject generated state/copy.
export interface CreatePostForOwnerArgs {
  campaignId: string;
  ownerId: string;
  assetType?: Post['assetType'];
  language?: string | null;
  lengthSpec?: string | null;
  angle?: string | null;
  brandVoice?: string | null;
  driveFolderId?: string | null;
  heroFile?: string | null;
  platforms?: Post['platforms'];
  scheduledAt?: Date | null;
  // The instance run this post executes (cloned from the campaign's flow template).
  // Null for posts under a campaign that isn't attached to a flow (legacy copy-gen path).
  runId?: string | null;
}

export const createPostForOwner = (args: CreatePostForOwnerArgs): Promise<Post> =>
  prisma.post.create({
    data: {
      campaignId: args.campaignId,
      ownerId: args.ownerId,
      status: 'brief',
      ...(args.assetType ? { assetType: args.assetType } : {}),
      ...(args.language !== undefined ? { language: args.language } : {}),
      ...(args.lengthSpec !== undefined ? { lengthSpec: args.lengthSpec } : {}),
      ...(args.angle !== undefined ? { angle: args.angle } : {}),
      ...(args.brandVoice !== undefined ? { brandVoice: args.brandVoice } : {}),
      ...(args.driveFolderId !== undefined ? { driveFolderId: args.driveFolderId } : {}),
      ...(args.heroFile !== undefined ? { heroFile: args.heroFile } : {}),
      ...(args.platforms ? { platforms: args.platforms } : {}),
      ...(args.scheduledAt !== undefined ? { scheduledAt: args.scheduledAt } : {}),
      ...(args.runId ? { runId: args.runId } : {}),
    },
  });

// Scoped, state-guarded edit. updateMany guard = {id, ownerId, status ∈ EDITABLE}.
// Returns null if the guard didn't match — the route's 404 probe runs first, so a
// null here means wrong-state → 409 (can't edit a post the scheduler already owns).
export const updatePostFields = async (
  id: string,
  ownerId: string,
  data: Prisma.PostUpdateInput,
): Promise<Post | null> => {
  const r = await prisma.post.updateMany({
    where: { id, ownerId, status: { in: EDITABLE } },
    data,
  });
  return r.count === 1 ? prisma.post.findFirst({ where: { id, ownerId } }) : null;
};

// Manual copy edit: overwrite the copy bag and land the post back at `review` so it is
// re-approved before publishing. Guarded to review|ready (a post with generated copy the
// user is editing); returns null on state miss (route maps to 409). Owner-scoped.
export const editPostCopy = async (
  id: string,
  ownerId: string,
  copy: { body: string; threads: string; x: string },
): Promise<Post | null> => {
  const r = await prisma.post.updateMany({
    where: { id, ownerId, status: { in: ['review', 'ready'] } },
    data: { copy: copy as unknown as Prisma.InputJsonValue, status: 'review' },
  });
  return r.count === 1 ? prisma.post.findFirst({ where: { id, ownerId } }) : null;
};

// Set (or clear, ref=null) the post's user-uploaded reference image (concept gate). Refused
// while the scheduler holds the row (status=posting). Owner-scoped.
export const setPostReferenceImage = async (
  id: string,
  ownerId: string,
  ref: string | null,
): Promise<Post | null> => {
  const r = await prisma.post.updateMany({
    where: { id, ownerId, status: { not: 'posting' } },
    data: { referenceImage: ref },
  });
  return r.count === 1 ? prisma.post.findFirst({ where: { id, ownerId } }) : null;
};

// Orchestration-internal: attach generated media to a post the executor owns.
// Unlike updatePostFields this is NOT user-edit-gated (the post is already `ready`
// after concept_writer's auto-approve), but it still refuses a row the scheduler is
// actively publishing (status=posting) to avoid racing the worker. Owner-scoped.
// Set the post's hero asset, and optionally its assetType so the two stay consistent — a
// media agent knows what it produced (single video/image, or a carousel CSV), and the
// publish validator checks assetType against the asset count. Without this a 'carousel'
// post that a video step filled with ONE asset fails "carousel needs >=2 assets".
export const setPostHeroFile = async (
  id: string,
  ownerId: string,
  heroFile: string,
  assetType?: Post['assetType'],
): Promise<Post | null> => {
  const r = await prisma.post.updateMany({
    where: { id, ownerId, status: { not: 'posting' } },
    data: { heroFile, ...(assetType ? { assetType } : {}) },
  });
  return r.count === 1 ? prisma.post.findFirst({ where: { id, ownerId } }) : null;
};

// Attach generated media for ONE asset type (item 5b). Merges the ref into the per-type
// assetMedia map so a post that produces MULTIPLE asset types (carousel for FB, video for IG)
// keeps them side-by-side instead of clobbering a single heroFile. For a legacy single-asset
// post (no per-platform map) it ALSO updates heroFile+assetType so nothing about that path
// changes. The executor is the only writer per run, so the read-modify-write is race-free.
export const attachPostMedia = async (
  id: string,
  ownerId: string,
  assetType: Post['assetType'],
  ref: string,
): Promise<Post | null> => {
  const post = await prisma.post.findFirst({ where: { id, ownerId } });
  if (!post || post.status === 'posting') return null;
  const media = { ...((post.assetMedia as Record<string, string> | null) ?? {}), [assetType]: ref };
  const singleAsset = post.platformAssets == null; // no per-platform map → keep legacy hero
  const r = await prisma.post.updateMany({
    where: { id, ownerId, status: { not: 'posting' } },
    data: {
      assetMedia: media as Prisma.InputJsonValue,
      ...(singleAsset ? { heroFile: ref, assetType } : {}),
    },
  });
  return r.count === 1 ? prisma.post.findFirst({ where: { id, ownerId } }) : null;
};

// Scoped delete, blocked only while the scheduler holds the row (status=posting).
// Returns: 'ok' | 'locked' (in-flight → 409). Not-found/wrong-tenant is handled by
// the route's prior 404 probe, so a 0-count here means the locked guard tripped.
export const deletePost = async (
  id: string,
  ownerId: string,
): Promise<'ok' | 'locked'> => {
  const r = await prisma.post.deleteMany({
    where: { id, ownerId, status: { not: 'posting' } },
  });
  return r.count === 1 ? 'ok' : 'locked';
};
