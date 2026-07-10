// UserMemory repo (Core-Intelligence P3) — durable per-owner facts Atria recalls across sessions.
// Owner-scoped everywhere. Keyword-first recall (no embeddings yet): callers rank in the service
// layer. Keyed facts upsert (one row per owner+kind+key); freeform facts (key null) de-dupe on
// identical content so repeated turns don't spam the store.
import { prisma } from '../client.ts';

export type MemoryKind = 'product' | 'brand' | 'audience' | 'preference' | 'contact' | 'fact';

export interface MemoryRow {
  id: string;
  kind: string;
  key: string | null;
  content: string;
  usedCount: number;
  updatedAt: Date;
}

const SELECT = { id: true, kind: true, key: true, content: true, usedCount: true, updatedAt: true } as const;

// Upsert a KEYED fact (one row per owner+kind+key — e.g. product "Atria" or contact "Lam"). Newer
// content overwrites. Returns nothing (fire-and-forget from capture paths).
export const rememberKeyed = async (
  ownerId: string,
  kind: MemoryKind,
  key: string,
  content: string,
  sourceSessionId?: string | null,
): Promise<void> => {
  await prisma.userMemory.upsert({
    where: { uq_memory_owner_kind_key: { ownerId, kind, key } },
    create: { ownerId, kind, key, content, sourceSessionId: sourceSessionId ?? null },
    update: { content, sourceSessionId: sourceSessionId ?? null },
  });
};

// Store a FREEFORM fact (key null). De-dupes on identical (owner,kind,content) so the same fact
// captured on multiple turns stays a single row.
export const rememberFreeform = async (
  ownerId: string,
  kind: MemoryKind,
  content: string,
  sourceSessionId?: string | null,
): Promise<void> => {
  const existing = await prisma.userMemory.findFirst({ where: { ownerId, kind, content }, select: { id: true } });
  if (existing) return;
  await prisma.userMemory.create({ data: { ownerId, kind, key: null, content, sourceSessionId: sourceSessionId ?? null } });
};

// All of an owner's memories, most-recently-updated first (recall ranks these in the service).
export const listMemories = async (ownerId: string): Promise<MemoryRow[]> =>
  prisma.userMemory.findMany({ where: { ownerId }, select: SELECT, orderBy: { updatedAt: 'desc' }, take: 200 });

// Bump usage counters for the facts actually surfaced this turn (relevance signal + "recently used").
export const markUsed = async (ownerId: string, ids: string[]): Promise<void> => {
  if (!ids.length) return;
  await prisma.userMemory.updateMany({ where: { ownerId, id: { in: ids } }, data: { usedCount: { increment: 1 } } });
};

export const forgetMemory = async (ownerId: string, id: string): Promise<boolean> =>
  (await prisma.userMemory.deleteMany({ where: { id, ownerId } })).count > 0;
