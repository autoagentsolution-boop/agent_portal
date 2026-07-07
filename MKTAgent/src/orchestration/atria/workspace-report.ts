// Atria workspace report — a compact "what's already happened" snapshot (recent campaigns,
// their posts, what each was about) that grounds campaign-scope replies. The user asked Atria
// to plan; a strategist that doesn't first show it KNOWS the existing campaigns reads as blind.
// Read-only, tenant-scoped, capped hard so it stays a hint (not a token sink) in the author
// prompt. Pure formatter split from the DB read for testability, mirroring signal-reader.ts.
import { prisma } from '../../db/client.ts';

const MAX_CAMPAIGNS = 5;
const MAX_POST_TITLES = 3;
const TITLE_LEN = 60;

const LIVE = new Set(['posted', 'partial']);

export interface CampaignReportRow {
  product: string;
  angle: string | null;
  postCount: number;
  postedCount: number; // posts live on at least one platform
  lastActivity: string; // ISO date of the newest post (or campaign update)
  recentPostTitles: string[]; // first line of the newest posts' copy — "what it was about"
}

export interface WorkspaceReport {
  campaignCount: number; // total, so the model can say "showing your 5 most recent of N"
  campaigns: CampaignReportRow[];
}

const firstLine = (copy: unknown): string | null => {
  const body = (copy as { body?: unknown } | null)?.body;
  if (typeof body !== 'string') return null;
  const line = body.split('\n').find((l) => l.trim())?.trim();
  return line ? line.slice(0, TITLE_LEN) : null;
};

export async function readWorkspaceReport(ownerId: string): Promise<WorkspaceReport> {
  // Counts come from light status-only rows; the heavy `copy` JSON is fetched separately,
  // capped per campaign, so a long-lived campaign never drags hundreds of copy blobs into
  // what runs on every campaign-scope chat turn.
  const [campaignCount, campaigns] = await Promise.all([
    prisma.campaign.count({ where: { ownerId } }),
    prisma.campaign.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
      take: MAX_CAMPAIGNS,
      select: {
        id: true,
        product: true,
        angle: true,
        updatedAt: true,
        posts: {
          orderBy: { updatedAt: 'desc' },
          select: { status: true, updatedAt: true },
        },
      },
    }),
  ]);

  // Bounded fan-out: ≤ MAX_CAMPAIGNS tiny queries, a few posts' copy each (some may lack copy).
  const titles = await Promise.all(campaigns.map((c) =>
    prisma.post.findMany({
      where: { campaignId: c.id },
      orderBy: { updatedAt: 'desc' },
      take: MAX_POST_TITLES * 2,
      select: { copy: true },
    }),
  ));

  return {
    campaignCount,
    campaigns: campaigns.map((c, i) => ({
      product: c.product,
      angle: c.angle,
      postCount: c.posts.length,
      postedCount: c.posts.filter((p) => LIVE.has(p.status)).length,
      lastActivity: (c.posts[0]?.updatedAt ?? c.updatedAt).toISOString().slice(0, 10),
      recentPostTitles: (titles[i] ?? [])
        .map((p) => firstLine(p.copy))
        .filter((t): t is string => Boolean(t))
        .slice(0, MAX_POST_TITLES),
    })),
  };
}

// Deterministic prose rendering — the no-LLM fallback and the verify surface. One line
// per campaign so the report stays scannable in a chat bubble.
export function formatWorkspaceReport(report: WorkspaceReport): string {
  if (report.campaignCount === 0) return 'No campaigns yet — this will be your first.';
  const lines = report.campaigns.map((c) => {
    const about = c.recentPostTitles.length ? ` Recent: ${c.recentPostTitles.map((t) => `“${t}”`).join(', ')}.` : '';
    const angle = c.angle ? ` (${c.angle})` : '';
    return `• ${c.product}${angle} — ${c.postCount} post(s), ${c.postedCount} live, last activity ${c.lastActivity}.${about}`;
  });
  const head = report.campaignCount > report.campaigns.length
    ? `Your ${report.campaigns.length} most recent campaigns (of ${report.campaignCount}):`
    : `Your campaigns so far:`;
  return [head, ...lines].join('\n');
}
