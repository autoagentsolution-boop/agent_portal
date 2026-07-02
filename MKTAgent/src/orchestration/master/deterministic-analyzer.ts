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

const inferOutputs = (t: string): GoalSpec['outputs'] => {
  const campaign = isCampaign(t);
  return {
    needsIdeation: campaign,
    needsStrategy: campaign,
    needsResearch: /\b(research|nghiên cứu|nghien cuu|competitor|đối thủ|market)\b/i.test(t),
    needsTextPost: true,
    needsInfographic: campaign || /\b(infographic|visual|hình ảnh thông tin|hình ảnh|hinh anh|image)\b/i.test(t),
    // Storyboard is independent of video. A video request also implies storyboard (the
    // planner enforces video ⇒ storyboard), so needsVideo OR an explicit storyboard word
    // both enable it. \b works here (all-ASCII keywords).
    needsStoryboard: /\b(video|reel|clip|short|tiktok|storyboard|kịch bản|kich ban|phân cảnh|phan canh)\b/i.test(t),
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

  return goalSpec.parse({
    outputs: inferOutputs(m),
    platforms,
    slots,
    confidence: Math.min(0.9, 0.3 + filled * 0.08),
    provider: 'deterministic-v1',
  });
};
