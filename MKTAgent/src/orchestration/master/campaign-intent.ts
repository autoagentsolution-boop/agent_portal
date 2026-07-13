// Campaign-create intent detector (item 2). After a flow is SAVED (run kind=template),
// a follow-up chat message must be routed to ONE of three outcomes:
//   - create : bind a SINGLE campaign to the already-saved flow (createCampaignFromFlow)
//   - plan   : a weekly/monthly BATCH ask → fall through to the strategist calendar planner
//   - ambiguous : both a create ask AND a batch signal → RECONFIRM with the user (single vs
//                 weekly) before we act, so Atria never silently reproduces a new flow.
//
// Why the split (bug 2026-07-13): the old broad PLAN_INTENT treated any of
// schedule|plan|daily as "route to planner", so a clear "create a first campaign 'Impression'
// … we can schedule it" was hijacked away from create-from-flow and the brain reproduced a
// whole new flow ("MonthPlan-Atria"). Incidental single-post timing words (schedule/on demand)
// must NOT count as a batch-plan signal; only real cadence/calendar words do.
//
// Deterministic + dependency-free (mirrors deterministic-analyzer style). VN+EN, with
// Unicode-aware boundaries so Vietnamese diacritics match (JS \b is ASCII-only).
import type { GoalSpec } from '../schemas/goal-spec.ts';

// Unicode-aware word boundary (same technique as deterministic-analyzer.ts). `lit` is
// the inner alternation; lookarounds on \p{L} give a real boundary for vi+en alike.
const wordRe = (lit: string): RegExp => new RegExp(`(?<![\\p{L}])(${lit})(?![\\p{L}])`, 'iu');

// A create verb AND a campaign/post noun must both be present — a bare "campaign" (or a
// message merely mentioning it) shouldn't hijack a legitimate "plan a different flow".
const CREATE_VERB = wordRe(
  'create|make|start|set up|setup|launch|build|add|new|' +
  'tạo|tao|làm|lam|lập|lap|bắt đầu|bat dau|thêm|them|mở|mo',
);
const CAMPAIGN_NOUN = wordRe(
  'campaign|campaigns|post|posts|content|' +
  'chiến dịch|chien dich|bài|bai|bài viết|bai viet|nội dung|noi dung|task',
);

// BATCH / calendar signal — a request to plan MANY posts over a period. Cadence words
// (weekly/monthly/daily/hàng…) count ONLY when paired with a content noun (posts/content/
// campaigns), so an incidental "achieve their DAILY task" or "we can SCHEDULE it" is NOT a
// batch ask. This is the fix for the 2026-07-13 bug where bare cadence words hijacked a create.
const STRONG_BATCH_RE = new RegExp(
  '(?<![\\p{L}])(' +
  'content calendar|content plan|posting schedule|calendar|batch|multi[- ]?post|series of posts|' +
  'a month of|month.long|weeks? of content|' +
  '(?:weekly|monthly|daily)\\s+(?:posts?|content|campaigns?|updates?|bài|bai|nội dung|noi dung)|' +
  '(?:posts?|campaigns?|content)\\s+(?:for\\s+)?(?:the\\s+|this\\s+|next\\s+)?(?:week|month)|' +
  'post(?:ing)?\\s+(?:daily|weekly|monthly)|' +
  'chiến dịch\\s+(?:hàng\\s+|hằng\\s+)?(?:tuần|tháng)|chien dich\\s+(?:hang\\s+)?(?:tuan|thang)|' +
  '(?:bài|bai|nội dung|noi dung)\\s+(?:hàng\\s+|hằng\\s+|theo\\s+)?(?:tuần|tuan|tháng|thang|ngày|ngay)|' +
  'lịch đăng|lich dang|kế hoạch nội dung|ke hoach noi dung|nhiều bài|nhieu bai|chuỗi bài|chuoi bai' +
  ')(?![\\p{L}])',
  'iu',
);

// Strong single-create marker: an explicit campaign/post NAME (quoted) or "first" — a
// decisively single ask that wins over incidental scheduling words.
const NAME_OR_FIRST = /["“][^"”]{1,80}["”]|(?<![\p{L}])(first|đầu tiên|dau tien)(?![\p{L}])/iu;

// Bare affirmation to the save-offer's question ("Want to set up the first campaign?"), or the
// "single" answer to the single-vs-weekly reconfirm. Narrow so a random "yes" mid-conversation
// doesn't trigger a create; matches the whole trimmed message.
// Anchored + Unicode: `\b` is ASCII-only so `có\b` never matches (ó isn't a word char).
const BARE_AFFIRM = /^(yes|yep|yeah|sure|ok|okay|có|co|đồng ý|dong y|được|duoc|single|one|single campaign|đơn lẻ|don le|một|mot)[\s!.]*$/iu;

// Whole-message answer to the reconfirm choosing the batch/weekly path.
const WEEKLY_CHOICE = /^(weekly|monthly|weekly campaigns?|monthly campaigns?|theo tuần|theo tuan|theo tháng|theo thang|hàng tuần|hang tuan|hàng tháng|hang thang)[\s!.]*$/iu;

export interface CampaignIntent {
  isCreate: boolean;    // bind a single campaign to the saved flow now
  isPlan: boolean;      // batch/calendar ask → fall through to the strategist planner
  isAmbiguous: boolean; // create + batch both present → reconfirm single vs weekly first
  campaignName: string | null;
  postTitle: string | null;
}

const NONE: CampaignIntent = { isCreate: false, isPlan: false, isAmbiguous: false, campaignName: null, postTitle: null };

// Pull a quoted name after a keyword, e.g. campaign "Abstract User" → Abstract User.
const quotedAfter = (msg: string, keys: string[]): string | null => {
  for (const key of keys) {
    const m = msg.match(new RegExp(`${key}[^"“]*["“]([^"”]{1,80})["”]`, 'i'))?.[1]?.trim();
    if (m) return m;
  }
  return null;
};

const namesFrom = (m: string): Pick<CampaignIntent, 'campaignName' | 'postTitle'> => {
  const quotes = [...m.matchAll(/["“]([^"”]{1,80})["”]/g)].map((q) => q[1]?.trim()).filter(Boolean) as string[];
  const campaignName = quotedAfter(m, ['campaign', 'chiến dịch', 'chien dich']) ?? quotes[0] ?? null;
  const postTitle = quotedAfter(m, ['post', 'bài', 'bai']) ?? quotes[1] ?? null;
  return { campaignName, postTitle };
};

// Detect whether a follow-up on a SAVED flow asks to create a campaign, plan a batch, or is
// ambiguous. The prior goal is passed so a bare "yes" reads as accepting the save-offer.
export const detectCampaignIntent = (message: string, _prior: GoalSpec): CampaignIntent => {
  const m = message.trim();
  if (BARE_AFFIRM.test(m)) return { ...NONE, isCreate: true };
  if (WEEKLY_CHOICE.test(m)) return { ...NONE, isPlan: true };

  const hasCreate = CREATE_VERB.test(m) && CAMPAIGN_NOUN.test(m);
  const hasBatch = STRONG_BATCH_RE.test(m);
  const hasStrongCreate = hasCreate && NAME_OR_FIRST.test(m);

  // Genuine conflict: a NAMED single-campaign create AND a batch/calendar phrase together →
  // reconfirm (single vs weekly) rather than silently reproducing a new flow.
  if (hasBatch && hasStrongCreate) return { ...NONE, isAmbiguous: true, ...namesFrom(m) };

  // A batch/calendar phrase wins as a PLAN even alongside a create verb ("make a content
  // calendar") → fall through to Atria's strategist calendar planner.
  if (hasBatch) return { ...NONE, isPlan: true };

  // Strong single-create (explicit name or "first") — incidental scheduling words don't block it.
  if (hasStrongCreate) return { ...NONE, isCreate: true, ...namesFrom(m) };

  // Plain create (no name, no batch) → bind a single campaign to the flow.
  if (hasCreate) return { ...NONE, isCreate: true, ...namesFrom(m) };

  return NONE;
};
