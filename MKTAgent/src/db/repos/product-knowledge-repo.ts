// Product Knowledge library repo (item 6). A per-user, reusable store of analyzed product
// facts that ground copy/image/video prompts across many campaigns/posts — instead of
// re-analyzing per campaign. All queries are owner-scoped (tenant isolation).
import { prisma } from '../client.ts';
import type { ProductKnowledge, Prisma } from '../../../prisma/generated/prisma/client.ts';

export interface ProductKnowledgeInput {
  ownerId: string;
  name: string;
  productDetails: string;
  profile?: unknown;
  brandVoice?: string | null;
  language?: string | null;
  sourceDocs?: string[];
}

export const createProductKnowledge = (input: ProductKnowledgeInput): Promise<ProductKnowledge> =>
  prisma.productKnowledge.create({
    data: {
      ownerId: input.ownerId,
      name: input.name,
      productDetails: input.productDetails,
      profile: (input.profile ?? undefined) as Prisma.InputJsonValue | undefined,
      brandVoice: input.brandVoice ?? null,
      language: input.language ?? null,
      sourceDocs: input.sourceDocs ?? [],
    },
  });

export const listProductKnowledge = (ownerId: string): Promise<ProductKnowledge[]> =>
  prisma.productKnowledge.findMany({ where: { ownerId }, orderBy: { updatedAt: 'desc' } });

export const getProductKnowledge = (id: string, ownerId: string): Promise<ProductKnowledge | null> =>
  prisma.productKnowledge.findFirst({ where: { id, ownerId } });

// Scoped update. Only provided fields change. Returns null when not found / wrong tenant.
export const updateProductKnowledge = async (
  id: string,
  ownerId: string,
  patch: Partial<Omit<ProductKnowledgeInput, 'ownerId'>>,
): Promise<ProductKnowledge | null> => {
  const r = await prisma.productKnowledge.updateMany({
    where: { id, ownerId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.productDetails !== undefined ? { productDetails: patch.productDetails } : {}),
      ...(patch.profile !== undefined ? { profile: patch.profile as Prisma.InputJsonValue } : {}),
      ...(patch.brandVoice !== undefined ? { brandVoice: patch.brandVoice } : {}),
      ...(patch.language !== undefined ? { language: patch.language } : {}),
      ...(patch.sourceDocs !== undefined ? { sourceDocs: patch.sourceDocs } : {}),
    },
  });
  return r.count === 1 ? prisma.productKnowledge.findFirst({ where: { id, ownerId } }) : null;
};

// Merge a freshly analyzed doc into an existing entry: append the new details + docs and
// re-point voice/language when the new analysis has them (append + refresh, not diff-merge).
export const mergeProductKnowledge = async (
  id: string,
  ownerId: string,
  add: { productDetails: string; profile?: unknown; brandVoice?: string | null; language?: string | null; sourceDocs?: string[] },
): Promise<ProductKnowledge | null> => {
  const cur = await prisma.productKnowledge.findFirst({ where: { id, ownerId } });
  if (!cur) return null;
  return updateProductKnowledge(id, ownerId, {
    productDetails: [cur.productDetails, add.productDetails].filter(Boolean).join('\n\n'),
    profile: add.profile ?? cur.profile,
    brandVoice: add.brandVoice ?? cur.brandVoice,
    language: add.language ?? cur.language,
    sourceDocs: [...cur.sourceDocs, ...(add.sourceDocs ?? [])],
  });
};

export const deleteProductKnowledge = async (id: string, ownerId: string): Promise<boolean> => {
  const r = await prisma.productKnowledge.deleteMany({ where: { id, ownerId } });
  return r.count === 1;
};

// Grounding text from a linked library entry, following the post→campaign link precedence
// (item 6). Returns null when neither is linked (caller falls back to brandContext / goal slot).
export const resolveLinkedKnowledge = async (
  ownerId: string,
  postPkId: string | null,
  campaignPkId: string | null,
): Promise<string | null> => {
  const id = postPkId ?? campaignPkId;
  if (!id) return null;
  const pk = await getProductKnowledge(id, ownerId);
  return pk?.productDetails?.trim() || null;
};
