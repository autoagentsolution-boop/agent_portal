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

export const setStatus = (id: string, status: PostStatus): Promise<Post> =>
  prisma.post.update({ where: { id }, data: { status } });
