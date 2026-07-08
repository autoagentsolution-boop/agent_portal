// Deterministic GoalSpec extractor — the fallback brain when Gemini is absent or
// returns garbage (same fallback pattern as gemini-intake-provider.ts). Regex
// helpers mirror src/agent/intake-provider.ts so behaviour is consistent with the
// existing intake path. Output flags drive the rule-based planner.
import { goalSpec, type GoalSpec } from '../schemas/goal-spec.ts';

const PLATFORMS: Array<[GoalSpec['platforms'][number], RegExp]> = [
  ['facebook', /\b(facebook|fb)\b/i],
  ['instagram', /\b(instagram|ig)\b/i],
  ['threads', /\bthreads\b/i],
  ['linkedin', /\blinkedin\b/i],
  ['x', /\b(x|twitter)\b/i],
];

// Exported: the campaign-from-flow path reuses this to honor a per-message platform
// override ("chỉ facebook") when creating a campaign under a flow whose template targets
// more platforms. Returns only the platforms explicitly named ([] if none).
export const parsePlatforms = (t: string): GoalSpec['platforms'] =>
  PLATFORMS.filter(([, re]) => re.test(t)).map(([p]) => p);

const sentenceAfter = (text: string, keys: string[]): string | null => {
  for (const key of keys) {
    const m = text.match(new RegExp(`${key}\\s*(?:là|la|is|:|=)?\\s*([^.;\\n]+)`, 'i'))?.[1]?.trim();
    if (m) return m.slice(0, 200);
  }
  return null;
};

const parseLanguage = (t: string): string | null => {
  if (/tiếng\s*việt|vietnamese|\bvi\b/i.test(t)) return 'vi';
  if (/english|tiếng\s*anh|\ben\b/i.test(t)) return 'en';
  if (/thai|tiếng\s*thái|\bth\b/i.test(t)) return 'th';
  return null;
};

const parseLength = (t: string): string | null => {
  if (/\b(short|ngắn|ngan)\b/i.test(t)) return 'short';
  if (/\b(medium|vừa|vua)\b/i.test(t)) return 'medium';
  if (/\b(long|dài|dai)\b/i.test(t)) return 'long';
  return t.match(/(\d{2,4})\s*(?:words?|từ)\b/i)?.[1] ?? null;
};

const parseProduct = (m: string): string | null => {
  const explicit = sentenceAfter(m, ['product', 'offer', 'sản phẩm', 'san pham', 'khóa', 'khoa']);
  if (explicit) return explicit;
  return m.match(/(?:cho|for|about|giới thiệu|gioi thieu)\s+([^,.;\n]{3,80})/i)?.[1]?.trim() ?? null;
};

// Product KNOWLEDGE — the descriptive clause about WHAT the product does, distinct
// from its short name. Fires only on knowledge verbs (chuyên/giúp/cung cấp/helps/…),
// not on a bare "sản phẩm của tôi", so a placeholder never satisfies the knowledge
// gate. Captures a longer span than parseProduct (commas allowed, up to ~600 chars).
const KNOWLEDGE_KEYS = [
  'chuyên', 'chuyen', 'giúp', 'giup', 'cung cấp', 'cung cap', 'chuyên về', 'chuyen ve',
  'helps', 'provides', 'offers', 'specializes in', 'là dịch vụ', 'la dich vu', 'là nền tảng', 'la nen tang',
];
const parseProductDetails = (m: string): string | null => {
  for (const key of KNOWLEDGE_KEYS) {
    const v = m.match(new RegExp(`${key}\\s+([^.;\\n]{12,})`, 'i'))?.[1]?.trim();
    if (v) return v.slice(0, 600);
  }
  return null;
};

// Who is marketing + the scope. company before business (a "công ty" message must not
// fall to business). Multi-word VN phrases use plain substring match — \b can't bound a
// diacritic (the wordRe lesson) and these phrases are distinctive enough to be safe.
export const parseAccountType = (t: string): NonNullable<GoalSpec['slots']['accountType']> | null => {
  if (/công ty|cong ty|doanh nghiệp|doanh nghiep|\bcompany\b|\benterprise\b|\bcorporation\b/i.test(t)) return 'company';
  if (/thương hiệu|thuong hieu|\bbrand\b|\bshop\b|cửa hàng|cua hang|\bstore\b|\bbusiness\b/i.test(t)) return 'business';
  if (/cá nhân|ca nhan|\bpersonal\b|bản thân|ban than|\bmyself\b|\bindividual\b|\bfreelance\b/i.test(t)) return 'personal';
  return null;
};

// Output-flag inference. Defaults: marketing requests need a text post + publishing
// unless the user clearly only wants an asset. Media flags are opt-in by keyword.
// A broad branding/campaign request runs the fuller idea→strategy flow (and an
// image), versus a plain "write a post" which stays minimal.
const isCampaign = (t: string): boolean =>
  /\b(campaign|branding|brand|chiến dịch|chien dich|thương hiệu|thuong hieu|lên ý tưởng|len y tuong|chiến lược|chien luoc|strategy)\b/i.test(t);

// Campaign framing (Atria Phase 03). Detect a MULTI-POST intent (plan a month, weekly content,
// content calendar, N posts) → 'campaign'; a concentrated one-shot push → 'spotlight'; else the
// default single post. Duration + cadence are parsed from the phrasing (sensible defaults when
// unstated) and only meaningful when scope !== 'single'.
// Deliberately NARROW: bare "campaign"/"branding" already drives the rich SINGLE-post pipeline
// (isCampaign below) — only an unambiguous MULTI-post intent (a calendar, a duration, a cadence,
// an explicit push) escalates to campaign/spotlight scope, so existing one-post goals are unchanged.
const SPOTLIGHT_RE = /\b(spotlight campaign|big push|launch push|launch campaign|content blitz)\b/i;
const CAMPAIGN_PLAN_RE = /\b(content calendar|content plan|posting schedule|plan (?:a|the|out|my)?\s*(?:month|week|content)|a month of|weeks? of content|weekly (?:posts?|content)|month.long campaign|multi.?post|series of posts|lịch đăng|lich dang|kế hoạch nội dung|ke hoach noi dung)\b/i;

const parseDurationWeeks = (t: string): number | null => {
  const w = t.match(/(\d{1,2})\s*(?:weeks?|tuần|tuan)\b/i)?.[1];
  if (w) return Math.min(52, Math.max(1, Number(w)));
  const mo = t.match(/(\d{1,2})\s*(?:months?|tháng|thang)\b/i)?.[1];
  if (mo) return Math.min(52, Math.max(1, Number(mo) * 4));
  if (/\b(a month|one month|month.long|monthly|một tháng|mot thang|hàng tháng|hang thang)\b/i.test(t)) return 4;
  if (/\b(a week|one week|weekly|một tuần|mot tuan|hàng tuần|hang tuan)\b/i.test(t)) return 1;
  return null;
};

const parseCadencePerWeek = (t: string): number | null => {
  const n = t.match(/(\d{1,2})\s*(?:posts?|bài|bai)\s*(?:a|per|\/|mỗi|moi)?\s*(?:week|tuần|tuan)/i)?.[1]
    ?? t.match(/(\d{1,2})\s*(?:times?|lần|lan)\s*(?:a|per|\/|mỗi|moi)?\s*(?:week|tuần|tuan)/i)?.[1];
  if (n) return Math.min(21, Math.max(1, Number(n)));
  if (/\bdaily\b|mỗi ngày|moi ngay|every day\b/i.test(t)) return 7;
  return null;
};

// scope + (weeks, perWeek). Defaults 4 weeks × 3/week for a campaign with unstated cadence.
const inferCampaign = (t: string): Pick<GoalSpec, 'campaignScope' | 'duration' | 'cadence'> => {
  const isSpotlight = SPOTLIGHT_RE.test(t);
  const isPlan = CAMPAIGN_PLAN_RE.test(t) || parseDurationWeeks(t) !== null || parseCadencePerWeek(t) !== null;
  const scope: GoalSpec['campaignScope'] = isSpotlight ? 'spotlight' : isPlan ? 'campaign' : 'single';
  if (scope === 'single') return { campaignScope: 'single', duration: null, cadence: null };
  // Spotlight = one concentrated week by default; a planned campaign defaults to a month × 3/week.
  const weeks = parseDurationWeeks(t) ?? (scope === 'spotlight' ? 1 : 4);
  const perWeek = parseCadencePerWeek(t) ?? (scope === 'spotlight' ? 5 : 3);
  return { campaignScope: scope, duration: { weeks }, cadence: { postsPerWeek: perWeek } };
};

// Auto-publish intent (decision 2026-07-08): default OFF (the post halts at the approval gate). Only
// an explicit "publish without review" phrasing flips it — so a plain "post this to Facebook" still
// gets the human gate, while "đăng luôn khỏi duyệt" / "auto-publish" honors the user's hands-off ask.
const parseAutoPublish = (t: string): boolean =>
  /\b(auto.?publish|publish automatically|post automatically|no review|without review)\b/i.test(t)
  || /(đăng luôn|dang luon|tự động đăng|tu dong dang|đăng tự động|dang tu dong|khỏi duyệt|khoi duyet|không cần duyệt|khong can duyet|không cần duyệt gì|tự đăng|tu dang)/i.test(t);

const inferOutputs = (t: string): GoalSpec['outputs'] => {
  const campaign = isCampaign(t);
  // A carousel / multiple images → the storyboard produces the slides (NOT a single
  // infographic). assetTypeFromOutputs then resolves storyboard-only → 'carousel'.
  const carousel = /\b(carousel|multiple images?|nhiều ảnh|nhieu anh|nhiều hình|nhieu hinh|nhiều tấm|nhieu tam|slides?|album)\b/i.test(t);
  return {
    needsIdeation: campaign,
    needsStrategy: campaign,
    // Researcher is now a LIVE, BILLED Gemini grounded call — narrow the trigger so a ubiquitous
    // word doesn't fire a paid search. Bare "market" (go-to-market, target market, "market this")
    // is far too common; require "market research" / competitor / explicit research intent instead.
    needsResearch: /\b(research|nghiên cứu|nghien cuu|competitor|đối thủ|market research|nghiên cứu thị trường)\b/i.test(t),
    needsTextPost: true,
    needsInfographic: !carousel && (campaign || /\b(infographic|visual|hình ảnh thông tin|hình ảnh|hinh anh|image)\b/i.test(t)),
    // Storyboard is independent of video. A video request also implies storyboard (the
    // planner enforces video ⇒ storyboard), and a carousel needs it for the slides, so any
    // of those enable it. \b works here (all-ASCII keywords).
    needsStoryboard: carousel || /\b(video|reel|clip|short|tiktok|storyboard|kịch bản|kich ban|phân cảnh|phan canh)\b/i.test(t),
    needsVideo: /\b(video|reel|clip|short|tiktok)\b/i.test(t),
    needsPublishing: !/\b(draft only|chỉ nháp|chi nhap|don't publish|do not publish|không đăng|khong dang)\b/i.test(t),
  };
};

// ── Subtractive refinement ───────────────────────────────────────────────────
// A removal delta: which output flags to turn OFF and which platforms to drop. Kept
// SEPARATE from GoalSpec — it's a delta instruction for a refinement turn, not state.
// `disableOutputs` names map 1:1 to GoalSpec.outputs flags (minus the "needs" prefix).
export type RemovableOutput = 'ideation' | 'strategy' | 'research' | 'infographic' | 'storyboard' | 'video' | 'publishing';
export interface Removals {
  disableOutputs: RemovableOutput[];
  dropPlatforms: GoalSpec['platforms'];
}

export const emptyRemovals = (): Removals => ({ disableOutputs: [], dropPlatforms: [] });

// Unicode-aware word boundary. JS `\b` only knows ASCII word chars, so `\bbỏ\b` never
// matches (the diacritic "ỏ" isn't [A-Za-z0-9_]). Lookarounds on \p{L} (any letter)
// give a real boundary for Vietnamese + English alike. `lit` is the inner alternation.
const wordRe = (lit: string): RegExp => new RegExp(`(?<![\\p{L}])(${lit})(?![\\p{L}])`, 'iu');

// Removal verbs (vi+en). Only when one of these is present do we look for targets —
// "add a video" must never trip the video removal. We require a removal verb anywhere
// in the message, then collect every named target.
const REMOVAL_VERB = wordRe('bỏ|bo|remove|drop|đừng|dung|bớt|bot|không cần|khong can|khỏi|khoi|delete|exclude|no longer|without');

const OUTPUT_TARGETS: Array<[RemovableOutput, RegExp]> = [
  ['storyboard', wordRe('storyboard|kịch bản|kich ban|phân cảnh|phan canh')],
  ['video', wordRe('video|reel|clip|short|tiktok')],
  ['infographic', wordRe('infographic|visual|hình ảnh|hinh anh|ảnh|anh|image|hình|hinh')],
  ['research', wordRe('research|nghiên cứu|nghien cuu|competitor|đối thủ')],
  ['strategy', wordRe('strategy|chiến lược|chien luoc')],
  ['ideation', wordRe('ideation|ý tưởng|y tuong|brainstorm')],
  ['publishing', wordRe('publish|publishing|đăng|dang|post')],
];

export const parseRemovals = (message: string): Removals => {
  if (!REMOVAL_VERB.test(message)) return emptyRemovals();
  const disableOutputs = OUTPUT_TARGETS.filter(([, re]) => re.test(message)).map(([o]) => o);
  const dropPlatforms = parsePlatforms(message);
  return { disableOutputs, dropPlatforms };
};

export const analyzeDeterministic = (message: string): GoalSpec => {
  const m = message.trim();
  const platforms = parsePlatforms(m);
  const slots = {
    product: parseProduct(m) ?? undefined,
    productDetails: parseProductDetails(m) ?? undefined,
    accountType: parseAccountType(m) ?? undefined,
    angle: sentenceAfter(m, ['angle', 'góc', 'goc', 'brief', 'nhấn mạnh', 'nhan manh']) ?? undefined,
    brandVoice: sentenceAfter(m, ['tone', 'voice', 'brand voice', 'giọng', 'giong']) ?? undefined,
    targetAudience: sentenceAfter(m, ['audience', 'khách hàng', 'khach hang', 'target', 'đối tượng']) ?? undefined,
    language: parseLanguage(m) ?? undefined,
    lengthSpec: parseLength(m) ?? undefined,
  };
  const filled = Object.values(slots).filter(Boolean).length + platforms.length;
  const campaign = inferCampaign(m);

  return goalSpec.parse({
    outputs: inferOutputs(m),
    platforms,
    slots,
    ...campaign,
    autoPublish: parseAutoPublish(m),
    confidence: Math.min(0.9, 0.3 + filled * 0.08),
    provider: 'deterministic-v1',
  });
};
