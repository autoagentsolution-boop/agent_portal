import { logger } from '../logger.ts';
import { withRetry } from '../util/retry.ts';

const NARRATION_MODEL = 'gemini-2.5-flash';
const ENDPOINT = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export interface NarrationFixture {
  dish_name: string;
  dish_name_display: string;
  tagline: string;
  final_dish_description: string;
  ingredients: Array<{ label: string; prep: string; qty: string; order: number }>;
  finish_step: { label: string; prep: string; qty: string };
}

export interface NarrationRequest {
  fixture: NarrationFixture;
  targetSeconds?: number;
  wordsPerSecond?: number;
  styleHint?: string;
}

export interface NarrationResult {
  script: string;
  wordCount: number;
  estimatedSeconds: number;
}

const buildSystemPrompt = (req: NarrationRequest): string => {
  const targetSeconds = req.targetSeconds ?? 45;
  const wps = req.wordsPerSecond ?? 2.5;
  const targetWords = Math.round(targetSeconds * wps);
  const style = req.styleHint ?? 'natural, warm, cinematic, friendly Vietnamese food storytelling';

  const sortedIngredients = [...req.fixture.ingredients].sort((a, b) => a.order - b.order);
  const labelList = sortedIngredients
    .map((i, idx) => `${idx + 1}. ${i.label} (${i.prep}, ${i.qty})`)
    .join('\n');

  return `Bạn là một copywriter tiếng Việt chuyên viết kịch bản narration cho video Reel ẩm thực.

Hãy viết kịch bản narration tiếng Việt thuần Việt cho video ${targetSeconds} giây giới thiệu món "${req.fixture.dish_name_display}".

Mô tả món: ${req.fixture.final_dish_description}
Tagline: ${req.fixture.tagline}

Cấu trúc kịch bản:
- 3 giây mở đầu: 1 câu hook giới thiệu món + cảm xúc.
- ${targetSeconds - 6} giây thân: tour qua các nguyên liệu theo thứ tự dưới đây, mỗi nguyên liệu chỉ 1 câu ngắn ~2-3 giây, mượt mà liền mạch không liệt kê khô khan. Nhóm nguyên liệu cùng loại lại nếu cần để tự nhiên hơn.
- 3 giây kết: 1 câu CTA mời người xem thưởng thức.

Nguyên liệu theo thứ tự (từ dưới lên):
${labelList}
${sortedIngredients.length + 1}. ${req.fixture.finish_step.label} (${req.fixture.finish_step.prep}, ${req.fixture.finish_step.qty})

Yêu cầu giọng văn: ${style}.
Mục tiêu khoảng ${targetWords} từ (tương đương ${targetSeconds} giây với tốc độ đọc tự nhiên).

Trả lời CHỈ với JSON đúng format sau, không markdown, không giải thích:
{"script": "<văn bản narration đầy đủ, mỗi câu kết thúc bằng dấu chấm hoặc dấu chấm than>"}`;
};

const stripCodeFence = (s: string): string => {
  let t = s.trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/m, '').trim();
  return t;
};

const countWords = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

const callGeminiFlash = async (apiKey: string, prompt: string): Promise<string> => {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.8 },
  };
  const r = await fetch(ENDPOINT(NARRATION_MODEL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 300);
    const err = new Error(`narration_http_${r.status}: ${txt}`);
    (err as { status?: number }).status = r.status;
    throw err;
  }
  const j = (await r.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const txt = j.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
  if (!txt) throw new Error('narration_empty_response');
  return txt;
};

export const generateNarration = async (req: NarrationRequest): Promise<NarrationResult> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY required');

  const targetSeconds = req.targetSeconds ?? 45;
  const wps = req.wordsPerSecond ?? 2.5;
  const prompt = buildSystemPrompt(req);

  const raw = await withRetry(() => callGeminiFlash(apiKey, prompt), {
    label: 'narration_gen',
    attempts: 6,
    baseMs: 3000,
    factor: 2,
    retryOn: [429, 500, 502, 503, 504],
  });

  const parsed = JSON.parse(stripCodeFence(raw)) as { script?: unknown };
  if (typeof parsed.script !== 'string' || !parsed.script.trim()) {
    throw new Error(`narration_bad_shape: ${raw.slice(0, 200)}`);
  }
  const script = parsed.script.trim();
  const wordCount = countWords(script);
  const estimatedSeconds = wordCount / wps;
  logger.info('narration_generated', {
    dish: req.fixture.dish_name,
    wordCount,
    estimatedSeconds: Number(estimatedSeconds.toFixed(1)),
    targetSeconds,
  });

  return { script, wordCount, estimatedSeconds };
};

// Voice IDs ready for ttsRoute(). HoaiMy = female, NamMinh = male.
export const VOICES_AB = {
  HoaiMy: 'edge:vi-VN-HoaiMyNeural',
  NamMinh: 'edge:vi-VN-NamMinhNeural',
} as const;
export type VoiceLabel = keyof typeof VOICES_AB;
