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
