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

const parsePlatforms = (t: string): GoalSpec['platforms'] =>
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

// Output-flag inference. Defaults: marketing requests need a text post + publishing
// unless the user clearly only wants an asset. Media flags are opt-in by keyword.
const inferOutputs = (t: string): GoalSpec['outputs'] => ({
  needsResearch: /\b(research|nghiên cứu|nghien cuu|competitor|đối thủ|market)\b/i.test(t),
  needsTextPost: true,
  needsInfographic: /\b(infographic|visual|hình ảnh thông tin)\b/i.test(t),
  needsVideo: /\b(video|reel|clip|short|tiktok)\b/i.test(t),
  needsPublishing: !/\b(draft only|chỉ nháp|chi nhap|don't publish|do not publish|không đăng|khong dang)\b/i.test(t),
});

export const analyzeDeterministic = (message: string): GoalSpec => {
  const m = message.trim();
  const platforms = parsePlatforms(m);
  const slots = {
    product: parseProduct(m) ?? undefined,
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
