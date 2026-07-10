// Lead-collection awareness (P4-lite) — an HONEST readiness check so Atria can tell the user, during
// the conversation, that lead collection will run on their marketing flow. Lead capture is per-post:
// the cron (ENABLE_LEADS_CRON) watches comments on a PUBLISHED post that carries a capture keyword, on
// the commentable platforms the user has actually CONNECTED. So "ready" = cron enabled AND at least one
// target platform is a live connection. We never claim it when it isn't true (no connection / cron off).
import { env } from '../config/env.ts';
import { defaultTokenStatusReader } from '../connectors/runtime/connection-resolver.ts';
import { detectLanguage } from '../orchestration/master/detect-language.ts';
import type { GoalSpec } from '../orchestration/schemas/goal-spec.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

// Platforms whose comments the lead collector can read (mirrors comment-watch.ts COMMENTABLE).
const COMMENTABLE: SocialPlatform[] = ['facebook', 'instagram', 'threads', 'linkedin', 'x'];

export interface LeadReadiness {
  ready: boolean; // cron on AND ≥1 target platform is a live connection
  connected: SocialPlatform[]; // the target platforms that are actually connected
  cronEnabled: boolean;
}

// Which of the goal's target platforms are live connections + whether lead collection can run at all.
export async function leadCollectionReadiness(ownerId: string, targets: SocialPlatform[]): Promise<LeadReadiness> {
  const cronEnabled = env.ENABLE_LEADS_CRON;
  const relevant = COMMENTABLE.filter((p) => targets.includes(p));
  if (!relevant.length) return { ready: false, connected: [], cronEnabled };
  const now = Date.now();
  const rows = await defaultTokenStatusReader(ownerId);
  const byPlatform = new Map(rows.map((r) => [r.platform, r]));
  const connected = relevant.filter((p) => {
    const row = byPlatform.get(p);
    return Boolean(row && row.status === 'active' && (!row.expiresAt || row.expiresAt.getTime() > now));
  });
  return { ready: cronEnabled && connected.length > 0, connected, cronEnabled };
}

const PLATFORM_NAME: Record<SocialPlatform, string> = {
  facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', linkedin: 'LinkedIn', x: 'X',
};

// A short, language-aware line Atria appends to a planned marketing reply — ONLY when lead collection
// is genuinely ready. Honest phrasing: it runs once posts publish with a capture keyword. Returns null
// when not ready (Atria stays silent rather than over-promising).
export async function buildLeadAwarenessNote(
  ownerId: string,
  goal: GoalSpec,
  userMessage: string,
): Promise<string | null> {
  if (!goal.outputs.needsPublishing) return null;
  const readiness = await leadCollectionReadiness(ownerId, goal.platforms);
  if (!readiness.ready) return null;
  const names = readiness.connected.map((p) => PLATFORM_NAME[p]).join(', ');
  const vi = detectLanguage(userMessage) === 'vi';
  return vi
    ? `📥 Mình cũng sẽ chạy thu thập khách hàng tiềm năng trên các kênh đã kết nối của bạn (${names}) — khi bài đăng dùng từ khóa thu hút, ai bình luận sẽ được tự động ghi nhận và chấm điểm.`
    : `📥 I'll also run lead collection on your connected channels (${names}) — once a post publishes with a capture keyword, anyone who comments is captured and scored automatically.`;
}
