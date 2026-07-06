// Memory agent (Atria Phase 02) — a thin read/write facade over EXISTING tables
// (User + ProductKnowledge). NOT a new store: other agents call this instead of
// reaching into user-repo / product-knowledge-repo directly, so "what do we know
// about this owner/product" has one call-site. Owner-scoped everywhere — never
// leaks another tenant's products.
import { getUserById } from '../db/repos/user-repo.ts';
import {
  listProductKnowledge,
  getProductKnowledge,
  updateProductKnowledge,
} from '../db/repos/product-knowledge-repo.ts';
import type { ProductKnowledge } from '../../prisma/generated/prisma/client.ts';

export interface OwnerProfile {
  ownerId: string;
  defaultLanguage: string | null;
  brandVoice: string | null;
  products: ProductProfile[];
}

export interface ProductProfile {
  id: string;
  name: string;
  summary: string | null;
  differentiators: string | null;
  targetAudience: string | null;
  proofPoints: string | null;
  brandVoice: string | null;
  language: string | null;
}

// Shape of the structured JSON stored in ProductKnowledge.profile (see
// analyze-documents.ts ProductProfile / analysis-prompt.ts). Read-only here —
// only the fields this facade maps out.
interface StructuredProfileJson {
  productSummary?: string;
  differentiators?: string;
  targetAudience?: string;
  proofPoints?: string;
}

// Minimal row shape the mapper needs — kept local (not the full Prisma
// ProductKnowledge) so it stays trivially unit-testable with a fake row.
interface ProductKnowledgeRow {
  id: string;
  name: string;
  productDetails: string;
  profile: unknown;
  brandVoice: string | null;
  language: string | null;
}

// Pure mapper: DB row -> ProductProfile. Structured profile JSON (when present)
// wins for summary; falls back to the always-present productDetails paragraph
// so `summary` is never empty when the entry has any grounding text at all.
export function toProductProfile(row: ProductKnowledgeRow): ProductProfile {
  const p = (row.profile ?? null) as StructuredProfileJson | null;
  return {
    id: row.id,
    name: row.name,
    summary: p?.productSummary?.trim() || row.productDetails?.trim() || null,
    differentiators: p?.differentiators?.trim() || null,
    targetAudience: p?.targetAudience?.trim() || null,
    proofPoints: p?.proofPoints?.trim() || null,
    brandVoice: row.brandVoice ?? null,
    language: row.language ?? null,
  };
}

// Aggregates the owner's language/voice defaults (User) with their whole
// Product Knowledge library (ProductKnowledge). Pure aggregation over existing
// repos — adds no table. Unknown owner -> empty profile (never throws).
export async function getProfile(ownerId: string): Promise<OwnerProfile> {
  const [user, rows] = await Promise.all([
    getUserById(ownerId),
    listProductKnowledge(ownerId),
  ]);
  return {
    ownerId,
    defaultLanguage: user?.defaultLanguage ?? null,
    brandVoice: user?.brandVoice ?? null,
    products: rows.map(toProductProfile),
  };
}

// Single library entry, owner-scoped (null on not-found OR wrong tenant — no
// existence leak, mirrors product-knowledge-repo's own null-on-miss contract).
export async function getProduct(
  ownerId: string,
  productKnowledgeId: string,
): Promise<ProductProfile | null> {
  const row = await getProductKnowledge(productKnowledgeId, ownerId);
  return row ? toProductProfile(row) : null;
}

// Selective save: only the fields present on `patch` change (Atria's
// user-editable/append decision). summary/differentiators/targetAudience/
// proofPoints live inside the row's structured `profile` JSON, so they are
// merged into the existing JSON (read-modify-write) rather than overwriting the
// whole blob; name/brandVoice/language are plain columns via the existing
// repo's scoped update. Owner-scoped — null on not-found/wrong-tenant.
export async function remember(
  ownerId: string,
  productKnowledgeId: string,
  patch: Partial<Omit<ProductProfile, 'id'>>,
): Promise<ProductProfile | null> {
  const current = await getProductKnowledge(productKnowledgeId, ownerId);
  if (!current) return null;

  const profileChanged =
    patch.summary !== undefined ||
    patch.differentiators !== undefined ||
    patch.targetAudience !== undefined ||
    patch.proofPoints !== undefined;

  const nextProfile: StructuredProfileJson = {
    ...((current.profile ?? {}) as StructuredProfileJson),
    ...(patch.summary !== undefined ? { productSummary: patch.summary ?? undefined } : {}),
    ...(patch.differentiators !== undefined ? { differentiators: patch.differentiators ?? undefined } : {}),
    ...(patch.targetAudience !== undefined ? { targetAudience: patch.targetAudience ?? undefined } : {}),
    ...(patch.proofPoints !== undefined ? { proofPoints: patch.proofPoints ?? undefined } : {}),
  };

  const updated: ProductKnowledge | null = await updateProductKnowledge(productKnowledgeId, ownerId, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.brandVoice !== undefined ? { brandVoice: patch.brandVoice } : {}),
    ...(patch.language !== undefined ? { language: patch.language } : {}),
    ...(profileChanged ? { profile: nextProfile } : {}),
  });
  return updated ? toProductProfile(updated) : null;
}
