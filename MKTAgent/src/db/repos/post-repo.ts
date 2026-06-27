// Post repository — the scheduler/copy-gen state machine lives on these queries.
// Mirrors the n8n scheduler's "pick due row / claim / write-back" but in SQL.
import { prisma } from '../client.ts';
import type { Post, PostStatus, Prisma } from '../../../prisma/generated/prisma/client.ts';

export type PostCreate = Prisma.PostUncheckedCreateInput;

export const createPost = (data: PostCreate): Promise<Post> => prisma.post.create({ data });

export const getPost = (id: string): Promise<Post | null> =>
  prisma.post.findUnique({ where: { id } });

// Copy-gen queue: oldest brief|rework first.
export const findCopyGenDue = (): Promise<Post | null> =>
  prisma.post.findFirst({
    where: { status: { in: ['brief', 'rework'] } },
    orderBy: { createdAt: 'asc' },
  });

// Copy-gen needs the parent Campaign (product/angle/leadsForm live there).
export type PostWithCampaign = Prisma.PostGetPayload<{ include: { campaign: true } }>;

export const findCopyGenDueWithCampaign = (): Promise<PostWithCampaign | null> =>
  prisma.post.findFirst({
    where: { status: { in: ['brief', 'rework'] } },
    orderBy: { createdAt: 'asc' },
    include: { campaign: true },
  });

// Scheduler queue: ready + scheduledAt in the past, oldest first.
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

export const updatePost = (id: string, data: Prisma.PostUpdateInput): Promise<Post> =>
  prisma.post.update({ where: { id }, data });

export const getPostWithCampaign = (id: string): Promise<PostWithCampaign | null> =>
  prisma.post.findUnique({ where: { id }, include: { campaign: true } });

// REST list: filter + keyset pagination by id. Fetches limit+1 to compute the
// next cursor without a second count query.
export interface ListPostsArgs {
  status?: PostStatus;
  campaignId?: string;
  limit: number;
  cursor?: string;
}

export const listPosts = (args: ListPostsArgs): Promise<Post[]> =>
  prisma.post.findMany({
    where: {
      ...(args.status ? { status: args.status } : {}),
      ...(args.campaignId ? { campaignId: args.campaignId } : {}),
    },
    orderBy: { id: 'asc' },
    take: args.limit + 1,
    ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
  });

// Atomic review-gate transitions. Guard on current status (same pattern as
// claimForPublish) so a stale UI can't approve a post that already moved on.
// Returns the updated row, or null if the guard didn't match (→ 409).
export const approveReview = async (
  id: string,
  scheduledAt: Date,
): Promise<Post | null> => {
  const r = await prisma.post.updateMany({
    where: { id, status: 'review' },
    data: { status: 'ready', scheduledAt },
  });
  return r.count === 1 ? getPost(id) : null;
};

export const rejectReview = async (id: string, feedback: string): Promise<Post | null> => {
  const r = await prisma.post.updateMany({
    where: { id, status: 'review' },
    data: { status: 'rework', feedback },
  });
  return r.count === 1 ? getPost(id) : null;
};

export const setStatus = (id: string, status: PostStatus): Promise<Post> =>
  prisma.post.update({ where: { id }, data: { status } });
