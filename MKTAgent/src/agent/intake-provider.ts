import type { AgentIntakeBody, AgentIntakeDraft } from '../api/schemas.ts';

export interface AgentIntakeProvider {
  parse(input: AgentIntakeBody): Promise<AgentIntakeDraft>;
}

const platforms = [
  ['facebook', /\b(facebook|fb)\b/i],
  ['instagram', /\b(instagram|ig)\b/i],
  ['threads', /\bthreads\b/i],
  ['linkedin', /\blinkedin\b/i],
  ['x', /\b(x|twitter)\b/i],
] as const;

const includesAny = (text: string, terms: string[]): boolean =>
  terms.some((term) => text.toLowerCase().includes(term));

const sentenceAfter = (text: string, keys: string[]): string | null => {
  for (const key of keys) {
    const re = new RegExp(`${key}\\s*(?:là|la|is|:|=)?\\s*([^.;\\n]+)`, 'i');
    const m = text.match(re)?.[1]?.trim();
    if (m) return m.slice(0, 200);
  }
  return null;
};

const parseLanguage = (text: string): string | null => {
  if (/tiếng\s*việt|vietnamese|\bvi\b/i.test(text)) return 'vi';
  if (/english|tiếng\s*anh|\ben\b/i.test(text)) return 'en';
  if (/thai|tiếng\s*thái|\bth\b/i.test(text)) return 'th';
  if (/japanese|tiếng\s*nhật|\bja\b/i.test(text)) return 'ja';
  if (/korean|tiếng\s*hàn|\bko\b/i.test(text)) return 'ko';
  return null;
};

const parseLength = (text: string): string | null => {
  if (/\b(short|ngắn|ngan)\b/i.test(text)) return 'short';
  if (/\b(medium|vừa|vua)\b/i.test(text)) return 'medium';
  if (/\b(long|dài|dai)\b/i.test(text)) return 'long';
  return text.match(/(\d{2,4})\s*(?:words?|từ)\b/i)?.[1] ?? null;
};

const parseAssetType = (text: string): 'image' | 'carousel' | 'video' | null => {
  if (/\b(video|mp4|clip)\b/i.test(text)) return 'video';
  if (/\b(carousel|slide|slides)\b/i.test(text)) return 'carousel';
  if (/\b(image|photo|ảnh|hình)\b/i.test(text)) return 'image';
  return null;
};

const parsePlatforms = (text: string): Array<'facebook' | 'instagram' | 'threads' | 'linkedin' | 'x'> =>
  platforms.filter(([, re]) => re.test(text)).map(([platform]) => platform);

const parseSchedule = (text: string, timezone: string): string | null => {
  const tomorrow = /\b(tomorrow|mai)\b/i.test(text);
  const hour = text.match(/(?:at|lúc|luc)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|sáng|chiều|tối)?/i);
  if (!hour || !tomorrow) return null;
  let h = Number(hour[1]);
  const minute = Number(hour[2] ?? 0);
  const meridiem = hour[3]?.toLowerCase();
  if ((meridiem === 'pm' || meridiem === 'chiều' || meridiem === 'tối') && h < 12) h += 12;
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, minute, 0, 0);
  // Date uses server local timezone. UI still shows local confirmation before approve.
  void timezone;
  return d.toISOString();
};

const parseProduct = (message: string): string | null => {
  const explicit = sentenceAfter(message, ['product', 'offer', 'sản phẩm', 'san pham', 'khóa', 'khoa']);
  if (explicit) return explicit;
  const forMatch = message.match(/(?:cho|for)\s+([^,.;\n]{3,80})/i)?.[1]?.trim();
  return forMatch ?? null;
};

const missing = (key: string, label: string, reason: string, required = true) => ({ key, label, reason, required });

export class DeterministicAgentIntakeProvider implements AgentIntakeProvider {
  async parse(input: AgentIntakeBody): Promise<AgentIntakeDraft> {
    const message = input.message.trim();
    const product = parseProduct(message) ?? undefined;
    const language = parseLanguage(message) ?? undefined;
    const defaultLength = parseLength(message) ?? undefined;
    const assetType = parseAssetType(message) ?? undefined;
    const selectedPlatforms = parsePlatforms(message);
    const angle = sentenceAfter(message, ['angle', 'góc', 'goc', 'brief', 'nhấn mạnh', 'nhan manh']) ?? undefined;
    const brandVoice = sentenceAfter(message, ['tone', 'voice', 'brand voice', 'giọng', 'giong']) ?? undefined;
    const brandContext = sentenceAfter(message, ['context', 'proof', 'bằng chứng', 'bang chung']) ?? undefined;
    const scheduledAt = parseSchedule(message, input.timezone) ?? undefined;
    const heroFile = message.match(/(?:file|video|image|ảnh|hình)\s*id\s*[:=]?\s*([\w,-]+)/i)?.[1] ?? undefined;
    const driveFolderId = message.match(/(?:folder|drive)\s*id\s*[:=]?\s*([\w-]+)/i)?.[1] ?? undefined;

    const missingFields = [
      !product ? missing('product', 'Product / offer', 'Needed to create the campaign.') : null,
      !angle ? missing('angle', 'Angle / product brief', 'Needed for persuasive copy instead of generic output.', false) : null,
      !language ? missing('language', 'Language', 'Needed so copy-gen writes in the right language.', false) : null,
      !brandVoice ? missing('brandVoice', 'Tone / brand voice', 'Needed to match the user or brand style.', false) : null,
      !assetType ? missing('assetType', 'Media type', 'Choose image, carousel or video before publish.', false) : null,
      !heroFile ? missing('heroFile', 'Drive media file ID(s)', 'Publish will fail without media IDs.', false) : null,
    ].filter(Boolean) as AgentIntakeDraft['missingFields'];

    const filled = [product, angle, language, defaultLength, assetType, brandVoice, selectedPlatforms.length, scheduledAt].filter(Boolean).length;
    const confidence = Math.min(0.95, 0.35 + filled * 0.08);

    return {
      selectedTemplateId: 'branding-video-post',
      selectedTemplateTitle: 'Branding / Social Video Post Flow',
      confidence,
      campaign: {
        ...(product ? { product } : {}),
        ...(angle ? { angle } : {}),
        ...(brandContext ? { brandContext } : {}),
        ...(language ? { language } : {}),
        ...(defaultLength ? { defaultLength } : {}),
        ...(brandVoice ? { brandVoice } : {}),
        platforms: selectedPlatforms.length ? selectedPlatforms : ['facebook'],
        timezone: input.timezone,
      },
      post: {
        ...(assetType ? { assetType } : {}),
        ...(language ? { language } : {}),
        ...(defaultLength ? { lengthSpec: defaultLength } : {}),
        ...(selectedPlatforms.length ? { platforms: selectedPlatforms } : {}),
        ...(scheduledAt ? { scheduledAt } : {}),
        ...(driveFolderId ? { driveFolderId } : {}),
        ...(heroFile ? { heroFile } : {}),
      },
      missingFields,
      nextQuestion: missingFields[0]
        ? `Please provide: ${missingFields[0].label}.`
        : 'Draft looks ready. Review fields, then create campaign and post brief.',
      assistantMessage: missingFields[0]
        ? `I can help you shape this into a working marketing flow. I’m missing ${missingFields[0].label.toLowerCase()} first. Share that detail and I’ll tighten the setup.`
        : 'I have enough to create a draft campaign and post brief. Review the setup summary, then I can open the active flow for generation and approval.',
      provider: 'deterministic-v1',
    };
  }
}

export const agentIntakeProvider: AgentIntakeProvider = new DeterministicAgentIntakeProvider();
