// Deterministic GoalSpec extractor — the fallback brain when Gemini is absent or
// returns garbage (same fallback pattern as gemini-intake-provider.ts). Regex
// helpers mirror src/agent/intake-provider.ts so behaviour is consistent with the
// existing intake path. Output flags drive the rule-based planner.
//
// FALLBACK-ONLY for intent (Track A, 2026-07-24). On the LIVE path the model DECLARES the intent:
// campaignScope/duration/cadence (inferCampaign), autoPublish (parseAutoPublish), qualityPref
// (parseQualityPref), the media output flags (inferOutputs), video target/length (parseVideoLength),
// email routing (parseEmailIntent) and removals (parseRemovals) are all emitted by requirement-prompt.ts
// and flow through requirement-analyzer's goalSpec.safeParse. The regex classifiers BELOW run ONLY when
// GEMINI_API_KEY is unset (requirement-analyzer's `fallback()`). They are the safety net, never an
// override that second-guesses a value the model declared — the language-fix philosophy applied to the
// whole goal (see contentLanguageFor). parsePlatforms + the @-address recipient are the two exceptions
// the live path still UNIONs in, because a platform name / email address is a FACT to extract, not an
// intent to classify.
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

// Words that mean "make a VIDEO". Bare `short` used to be in here and was a costly false positive:
// "Short punchy Vietnamese Instagram post" planned — and would have billed — a Veo video for a text
// post, because an adjective was read as the YouTube format. `shorts` (the format is always plural)
// and `youtube short` keep that intent without swallowing the adjective. Shared by the output
// inference, the removal targets and the runtime parser so the three can never drift apart.
const VIDEO_WORDS = 'video|reel|reels|clip|tiktok|shorts|youtube short';
const VIDEO_RE = new RegExp(`\\b(${VIDEO_WORDS})\\b`, 'i');

// Target VIDEO RUNTIME in seconds. Separate from parseLength, which is about copy length in words —
// "a 60 second video" and "a 300 word post" are different requests and used to collide in one slot.
//
// Only fires when a video was actually asked for: a duration in a non-video message ("reply within
// 2 minutes") must not silently set a video length. Requires an explicit unit so a bare number can
// never be mistaken for a runtime.
//
// CLAMPED, not rejected, to the renderable range (12-120s): a request for 5s or 10min still produces
// a video rather than failing the whole analysis. The clamp is safe to hide because the user approves
// the script at the cost gate, where the real runtime and its price are both shown before any spend.
const VIDEO_LENGTH_MIN_SEC = 12;
const VIDEO_LENGTH_MAX_SEC = 120;
const parseVideoLength = (t: string): number | null => {
  if (!VIDEO_RE.test(t)) return null;
  const sec = t.match(/(\d{1,3})\s*(?:s|sec|secs|second|seconds|giây|giay)\b/i)?.[1];
  const min = t.match(/(\d{1,2})\s*(?:m|min|mins|minute|minutes|phút|phut)\b/i)?.[1];
  const raw = sec ? Number(sec) : min ? Number(min) * 60 : null;
  if (raw === null || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.min(VIDEO_LENGTH_MAX_SEC, Math.max(VIDEO_LENGTH_MIN_SEC, Math.round(raw)));
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
// Recognise "campaign(s)" as a plannable noun too (bug 2026-07-13): users say "plan weekly/monthly
// campaigns" — not "weekly posts" — so a bare campaign-scope ask must still route to the strategist.
const CAMPAIGN_PLAN_RE = /\b(content calendar|content plan|posting schedule|plan (?:a|the|out|my)?\s*(?:month|week|content|campaigns?)|a month of|weeks? of content|(?:weekly|monthly) (?:posts?|content|campaigns?)|campaigns? (?:for )?(?:the |this |next )?(?:week|month)|month.long campaign|multi.?post|series of posts|lịch đăng|lich dang|kế hoạch nội dung|ke hoach noi dung|chiến dịch (?:hàng )?(?:tuần|tháng)|chien dich (?:hang )?(?:tuan|thang))\b/i;

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

// Creative-quality preference (Phase 06) — a regex-detectable stated intent. "high quality"/"chất lượng
// cao"/"chi tiết" → 'high'; "nhanh"/"tiết kiệm"/"economy" → 'economy'; unstated → 'standard'. Only scales
// the creative thinking-budget ceiling downstream, never node selection (golden unaffected).
const parseQualityPref = (t: string): GoalSpec['qualityPref'] => {
  if (/\b(high|highest|best|top|maximum|premium)\s+quality\b/i.test(t) || /\b(very detailed|in-?depth|premium)\b/i.test(t)
    || /(chất lượng cao|chat luong cao|chất lượng tốt nhất|chat luong tot nhat|kỹ lưỡng|ky luong|chi tiết|chi tiet|cao cấp|cao cap|tốt nhất|tot nhat)/i.test(t)) return 'high';
  if (/\b(economy|quick|fast|cheap|rough|draft quality|low quality)\b/i.test(t)
    || /(nhanh|tiết kiệm|tiet kiem|qua loa|sơ sài|so sai|đơn giản thôi|don gian thoi)/i.test(t)) return 'economy';
  return 'standard';
};

// Email intent (P4-lite): the user wants Atria to WRITE + SEND an email, not a social post. Fires on
// an explicit email send/write phrasing (vi+en) so a marketing message that merely mentions an address
// doesn't misroute. Extracts recipient address(es) + an optional explicit subject.
const EMAIL_SEND_EN = /\b(send|write|draft|compose|shoot|fire off)\s+(a |an |the |out\s+)?(e-?mail|mail)\b/i;
const EMAIL_SEND_VI = /(gửi|gui|soạn|soan|viết|viet)\s+(một\s+|mot\s+|cái\s+|cai\s+)?(email|mail|e-?mail|thư điện tử|thu dien tu|thư|thu)\b/i;
const EMAIL_TO = /\b(e-?mail)\b[^.\n]{0,40}\b(to|cho|đến|den|gửi cho|gui cho)\b/i;
const EMAIL_ADDR = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;

// `purpose` = what the email should say (occasion/message), the raw request minus the address plumbing,
// so the email_writer has the actual intent to write ("happy birthday", "follow-up after our call").
export interface EmailIntent { isEmail: boolean; to: string | null; subject: string | null; purpose: string | null }

export const parseEmailIntent = (message: string): EmailIntent => {
  const t = message;
  const isEmail = EMAIL_SEND_EN.test(t) || EMAIL_SEND_VI.test(t) || EMAIL_TO.test(t);
  if (!isEmail) return { isEmail: false, to: null, subject: null, purpose: null };
  const addrs = Array.from(t.matchAll(EMAIL_ADDR)).map((m) => m[1]!);
  const to = addrs.length ? Array.from(new Set(addrs)).join(', ') : null;
  const subject = sentenceAfter(t, ['subject', 'chủ đề', 'chu de', 'tiêu đề', 'tieu de']);
  // Strip email addresses + the "email:" label so the purpose reads as the actual message intent.
  const purpose = t.replace(EMAIL_ADDR, '').replace(/\b(e-?mail)\s*[:=]/gi, '').replace(/\s{2,}/g, ' ').trim().slice(0, 500) || null;
  return { isEmail: true, to, subject, purpose };
};

// Force the social pipeline OFF when the goal is an email — the email_writer→email_agent path owns it.
// EXCEPTION: research is kept. "Research X, then email the findings" is a legitimate compose — content_search
// grounds the email_writer (research_summary is one of its optional inputs). Dropping it here was BUG-7: the
// plan skipped straight to email_writer and the email was written from model knowledge, not real research.
export const emailOutputs = (base: GoalSpec['outputs']): GoalSpec['outputs'] => ({
  ...base,
  needsEmail: true,
  needsTextPost: false,
  needsIdeation: false,
  needsStrategy: false,
  needsResearch: base.needsResearch,
  needsInfographic: false,
  needsStoryboard: false,
  needsVideo: false,
  needsPublishing: false,
});

const inferOutputs = (t: string): GoalSpec['outputs'] => {
  const campaign = isCampaign(t);
  // A carousel / multiple images → the storyboard produces the slides (NOT a single
  // infographic). assetTypeFromOutputs then resolves storyboard-only → 'carousel'.
  const carousel = /\b(carousel|multiple images?|nhiều ảnh|nhieu anh|nhiều hình|nhieu hinh|nhiều tấm|nhieu tam|slides?|album)\b/i.test(t);
  const video = VIDEO_RE.test(t);
  // "storyboard" / "phân cảnh" name the storyboard deliverable unambiguously. "kịch bản" just means
  // SCRIPT — which is `video_script`'s job now, not storyboard's — so it only implies a storyboard
  // when no video was asked for. Without this split, "kịch bản video" would plan a storyboard the
  // video never consumes, on top of the script it actually wanted.
  const storyboardWord = /\b(storyboard|phân cảnh|phan canh)\b/i.test(t);
  const scriptWord = /\b(kịch bản|kich ban)\b/i.test(t);
  return {
    needsIdeation: campaign,
    needsStrategy: campaign,
    // Researcher is now a LIVE, BILLED Gemini grounded call — narrow the trigger so a ubiquitous
    // word doesn't fire a paid search. Bare "market" (go-to-market, target market, "market this")
    // is far too common; require "market research" / competitor / explicit research intent instead.
    needsResearch: /\b(research|nghiên cứu|nghien cuu|competitor|đối thủ|market research|nghiên cứu thị trường)\b/i.test(t),
    needsTextPost: true,
    needsInfographic: !carousel && (campaign || /\b(infographic|visual|hình ảnh thông tin|hình ảnh|hinh anh|image)\b/i.test(t)),
    // Storyboard is independent of video (2026-07-21): a video is planned by `video_script` and
    // rendered from it, so video keywords no longer enable storyboard — that used to plan (and pay
    // for) 3-6 frames the video never consumed. A carousel still needs it for the slides.
    needsStoryboard: carousel || storyboardWord || (scriptWord && !video),
    needsVideo: video,
    needsPublishing: !/\b(draft only|chỉ nháp|chi nhap|don't publish|do not publish|không đăng|khong dang)\b/i.test(t),
    needsEmail: false, // email intent is detected separately (parseEmailIntent) and OR'd in via emailOutputs()
    // DM intent isn't detected by this deterministic analyzer yet (Multi-channel Nurture Nodes Phase
    // 01 wires the flag + planner splice only — routing here is a follow-up, mirrors needsEmail's
    // history). A goal reaches dm_writer/dm_agent via taskTargets or an explicit GoalSpec today.
    needsDirectMessage: false,
    // Wall-greeting intent isn't detected by this deterministic analyzer yet (Multi-channel Nurture
    // Nodes Phase 02 wires the flag + planner splice only — routing here is a follow-up, mirrors
    // needsDirectMessage's history). A goal reaches greeting_writer/greeting_agent via taskTargets
    // or an explicit GoalSpec today.
    needsWallGreeting: false,
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
  ['video', wordRe(VIDEO_WORDS)],
  ['infographic', wordRe('infographic|visual|hình ảnh|hinh anh|ảnh|anh|image|hình|hinh')],
  ['research', wordRe('research|nghiên cứu|nghien cuu|competitor|đối thủ')],
  ['strategy', wordRe('strategy|chiến lược|chien luoc')],
  ['ideation', wordRe('ideation|ý tưởng|y tuong|brainstorm')],
  ['publishing', wordRe('publish|publishing|đăng|dang|post')],
];

export const parseRemovals = (message: string): Removals => {
  if (!REMOVAL_VERB.test(message)) return emptyRemovals();
  // A removal target counts ONLY when a removal verb sits NEAR it (same clause), not merely somewhere in
  // the message. "publish automatically without review" tripped this: "without" is a removal verb and
  // "publish" is a target, but they belong to different phrases — the user is publishing, only skipping
  // review. So it wrongly dropped the publish output AND (via the platform pass) the named platform.
  // Require the verb within a short window before/after the target token; a real removal ("remove the
  // video", "without a video", "bỏ facebook") always co-locates them, a false one ("publish ... without
  // review") does not.
  const nearVerb = (targetRe: RegExp): boolean => {
    const m = targetRe.exec(message);
    if (!m) return false;
    const i = m.index;
    // Window: the verb must appear within ~24 chars before the target (a modifier/verb precedes its
    // object in both EN and VI here) — enough for "remove the video" / "bỏ luôn video" but not a whole
    // clause away like "publish automatically without review".
    const before = message.slice(Math.max(0, i - 24), i);
    return REMOVAL_VERB.test(before);
  };
  const disableOutputs = OUTPUT_TARGETS.filter(([, re]) => nearVerb(re)).map(([o]) => o);
  // Platform removal is likewise gated on a nearby verb: "on Facebook, publish without review" must NOT
  // drop Facebook (the verb "without" is far from it and modifies "review"). "drop facebook" / "bỏ facebook"
  // keeps the verb adjacent, so a genuine platform removal still fires.
  const dropPlatforms = parsePlatforms(message).filter((p) => {
    const re = PLATFORMS.find(([name]) => name === p)?.[1];
    return re ? nearVerb(re) : false;
  });
  return { disableOutputs, dropPlatforms };
};

export const analyzeDeterministic = (message: string): GoalSpec => {
  const m = message.trim();
  const email = parseEmailIntent(m);
  // Email goal → the email path owns the plan: no social platforms, and the recipient/subject go to
  // the email slots. Otherwise the normal social parse runs unchanged.
  const platforms = email.isEmail ? [] : parsePlatforms(m);
  const slots = {
    product: parseProduct(m) ?? undefined,
    productDetails: parseProductDetails(m) ?? undefined,
    accountType: parseAccountType(m) ?? undefined,
    // Email path: fall back to the email purpose so the writer knows WHAT to say when there's no
    // explicit "angle:" clause.
    angle: (sentenceAfter(m, ['angle', 'góc', 'goc', 'brief', 'nhấn mạnh', 'nhan manh']) ?? (email.isEmail ? email.purpose : null)) ?? undefined,
    brandVoice: sentenceAfter(m, ['tone', 'voice', 'brand voice', 'giọng', 'giong']) ?? undefined,
    targetAudience: sentenceAfter(m, ['audience', 'khách hàng', 'khach hang', 'target', 'đối tượng']) ?? undefined,
    language: parseLanguage(m) ?? undefined,
    lengthSpec: parseLength(m) ?? undefined,
    videoLengthSec: parseVideoLength(m) ?? undefined,
    emailTo: email.to ?? undefined,
    emailSubject: email.subject ?? undefined,
  };
  const filled = Object.values(slots).filter(Boolean).length + platforms.length;
  const outputs = email.isEmail ? emailOutputs(inferOutputs(m)) : inferOutputs(m);
  const campaign = email.isEmail ? { campaignScope: 'single' as const, duration: null, cadence: null } : inferCampaign(m);

  return goalSpec.parse({
    outputs,
    platforms,
    slots,
    ...campaign,
    autoPublish: parseAutoPublish(m),
    qualityPref: parseQualityPref(m),
    confidence: Math.min(0.9, 0.3 + filled * 0.08),
    provider: 'deterministic-v1',
  });
};
