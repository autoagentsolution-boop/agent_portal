// Campaign-create intent detector (item 2). After a flow is SAVED (run kind=template),
// a follow-up chat message like "yes, create the first campaign" must NOT fork a new
// flow — it should bind a campaign to the ALREADY-saved flow. The router uses this to
// route a saved-template chat's message to the campaign-setup path instead of re-planning.
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

// A request to PLAN a batch/calendar/weekly schedule is a CONVERSATIONAL ask for Atria — NOT a
// "create the campaign now" command. Without this, "plan/make weekly posts" on a saved flow was
// hijacked into campaign creation + a hard redirect to the board (feedback 5). When these words are
// present (and it isn't a bare "yes"), let the message fall through to Atria's planner instead.
const PLAN_INTENT = wordRe(
  'weekly|week|calendar|schedule|plan|planning|batch|series|monthly|daily|' +
  'hằng tuần|hang tuan|hàng tuần|hàng tháng|hang thang|lịch|lich|kế hoạch|ke hoach|lên kế hoạch|len ke hoach|nhiều bài|nhieu bai|chuỗi|chuoi',
);

// Bare affirmation to the save-offer's question ("Want to set up the first campaign?").
// Kept narrow so a random "yes" mid-conversation doesn't trigger a create; requires the
// message to be essentially just the affirmation.
// Anchored + Unicode: `\b` is ASCII-only so `có\b` never matches (ó isn't a word char).
// Match the whole trimmed message as just the affirmation, allowing trailing punctuation.
const BARE_AFFIRM = /^(yes|yep|yeah|sure|ok|okay|có|co|đồng ý|dong y|được|duoc)[\s!.]*$/iu;

export interface CampaignIntent {
  isCreate: boolean;
  campaignName: string | null;
  postTitle: string | null;
}

// Pull a quoted name after a keyword, e.g. campaign "Abstract User" → Abstract User.
const quotedAfter = (msg: string, keys: string[]): string | null => {
  for (const key of keys) {
    const m = msg.match(new RegExp(`${key}[^"“]*["“]([^"”]{1,80})["”]`, 'i'))?.[1]?.trim();
    if (m) return m;
  }
  // Fallback: first quoted span anywhere (the first named thing the user typed).
  return null;
};

// Detect whether a follow-up on a SAVED flow asks to create a campaign/post. The prior
// goal is passed so a bare "yes" can be read as accepting the save-offer (which always
// asks about the first campaign) rather than needing an explicit noun.
export const detectCampaignIntent = (message: string, _prior: GoalSpec): CampaignIntent => {
  const m = message.trim();
  const bare = BARE_AFFIRM.test(m);
  // Planning language routes to Atria (conversational batch/weekly planning), never a forced create.
  if (!bare && PLAN_INTENT.test(m)) return { isCreate: false, campaignName: null, postTitle: null };
  const isCreate = bare || (CREATE_VERB.test(m) && CAMPAIGN_NOUN.test(m));
  if (!isCreate) return { isCreate: false, campaignName: null, postTitle: null };

  // Best-effort names from quotes: first quote → campaign, second → post title.
  const quotes = [...m.matchAll(/["“]([^"”]{1,80})["”]/g)].map((q) => q[1]?.trim()).filter(Boolean) as string[];
  const campaignName = quotedAfter(m, ['campaign', 'chiến dịch', 'chien dich']) ?? quotes[0] ?? null;
  const postTitle = quotedAfter(m, ['post', 'bài', 'bai']) ?? quotes[1] ?? null;
  return { isCreate: true, campaignName, postTitle };
};
