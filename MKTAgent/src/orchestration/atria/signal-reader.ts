// Atria signal reader (Phase 06) — derives behavioral SIGNALS from data the app ALREADY stores
// (campaign/post counts, products, edit ratio, completed campaigns, lead volume). Stores NOTHING
// new and reads NO message content / personal data — only structural counts. `deriveSignals` is
// pure (testable); `readSignals` is the thin DB wrapper. Signals feed the deterministic suggestion
// engine (atria-suggestions.ts), so every proactive nudge traces back to an explainable number.
import { prisma } from '../../db/client.ts';

export interface AtriaSignals {
  totalPosts: number;
  // The product with the most ONE-OFF (single-post) campaigns, and how many — the "you keep
  // posting about X piecemeal" signal. null when the user has no single-post history.
  oneOffTopProduct: string | null;
  oneOffTopProductCount: number;
  // Does that product already have a multi-post campaign? (Don't suggest planning one that exists.)
  hasActiveCampaignForTopProduct: boolean;
  editedPostCount: number;
  editedPostRatio: number; // copyEdited / totalPosts — the "you keep rewriting my copy" signal
  completedCampaignCount: number; // multi-post campaigns fully posted — the "repeat what worked" signal
  lastCompletedProduct: string | null; // the product of a completed campaign, so "repeat what worked" can NAME it
  leadCount: number; // captured leads — the "nurture these" signal
  // The product attracting the most leads, and how many — the "leads are spiking on X, ride it with a
  // campaign" signal. null when no lead carries a sourceProduct. Excludes products that already run a
  // multi-post campaign (don't suggest one that exists).
  leadTopProduct: string | null;
  leadTopProductCount: number;
}

export interface SignalInput {
  campaigns: Array<{ id: string; product: string; postCount: number }>;
  posts: Array<{ campaignId: string; status: string; copyEdited: boolean }>;
  leadCount: number;
  // Captured-lead counts per product (from lead.sourceProduct); null products are ignored. Optional
  // so existing callers/tests keep compiling — an absent list just yields no lead-spike signal.
  leadProducts?: Array<{ product: string | null; count: number }>;
}

const LIVE_POST = new Set(['posted', 'partial']);

export function deriveSignals(input: SignalInput): AtriaSignals {
  const singleProductCounts = new Map<string, number>();
  const multiProducts = new Set<string>();
  for (const c of input.campaigns) {
    if (c.postCount === 1) singleProductCounts.set(c.product, (singleProductCounts.get(c.product) ?? 0) + 1);
    if (c.postCount >= 2) multiProducts.add(c.product);
  }
  let oneOffTopProduct: string | null = null;
  let oneOffTopProductCount = 0;
  for (const [product, n] of singleProductCounts) {
    if (n > oneOffTopProductCount) { oneOffTopProductCount = n; oneOffTopProduct = product; }
  }

  const totalPosts = input.posts.length;
  const editedPostCount = input.posts.filter((p) => p.copyEdited).length;

  const statusesByCampaign = new Map<string, string[]>();
  for (const p of input.posts) {
    const arr = statusesByCampaign.get(p.campaignId) ?? [];
    arr.push(p.status);
    statusesByCampaign.set(p.campaignId, arr);
  }
  let completedCampaignCount = 0;
  let lastCompletedProduct: string | null = null;
  for (const c of input.campaigns) {
    if (c.postCount < 2) continue;
    const st = statusesByCampaign.get(c.id) ?? [];
    if (st.length > 0 && st.every((s) => LIVE_POST.has(s))) { completedCampaignCount++; lastCompletedProduct = c.product; }
  }

  // Lead spike per product: the product with the most leads that does NOT already run a campaign.
  let leadTopProduct: string | null = null;
  let leadTopProductCount = 0;
  for (const { product, count } of input.leadProducts ?? []) {
    if (!product || multiProducts.has(product)) continue;
    if (count > leadTopProductCount) { leadTopProductCount = count; leadTopProduct = product; }
  }

  return {
    totalPosts,
    oneOffTopProduct,
    oneOffTopProductCount,
    hasActiveCampaignForTopProduct: oneOffTopProduct ? multiProducts.has(oneOffTopProduct) : false,
    editedPostCount,
    editedPostRatio: totalPosts > 0 ? editedPostCount / totalPosts : 0,
    completedCampaignCount,
    lastCompletedProduct,
    leadCount: input.leadCount,
    leadTopProduct,
    leadTopProductCount,
  };
}

export async function readSignals(ownerId: string): Promise<AtriaSignals> {
  const [campaigns, posts, leadCount, leadByProduct] = await Promise.all([
    prisma.campaign.findMany({ where: { ownerId }, select: { id: true, product: true, _count: { select: { posts: true } } } }),
    prisma.post.findMany({ where: { ownerId }, select: { campaignId: true, status: true, copyEdited: true } }),
    prisma.lead.count({ where: { ownerId } }),
    prisma.lead.groupBy({ by: ['sourceProduct'], where: { ownerId, sourceProduct: { not: null } }, _count: true }),
  ]);
  return deriveSignals({
    campaigns: campaigns.map((c) => ({ id: c.id, product: c.product, postCount: c._count.posts })),
    posts,
    leadCount,
    leadProducts: leadByProduct.map((g) => ({ product: g.sourceProduct, count: g._count })),
  });
}
