import { readFile } from 'node:fs/promises';
import { logger } from '../logger.ts';
import { withRetry } from '../util/retry.ts';

const VERIFY_MODEL = 'gemini-2.5-flash';
const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export interface VerifyResult {
  detectedLabels: string[];
  duplicates: string[];
  missing: string[];
  extra: string[];
  isAcceptable: boolean;
  mismatchCount: number;
}

export interface VerifyOptions {
  tolerance?: number;
  model?: string;
}

const norm = (s: string): string =>
  s
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?]+$/u, '')
    .replace(/\s+/g, ' ');

const buildVerifyPrompt = (expectedLabels: string[]): string =>
  `You are a vision auditor for a Vietnamese food poster.

Task: Extract ONLY the INGREDIENT NAMES from each callout label box on the image.

Each callout has THREE lines of text:
- Line 1: INGREDIENT NAME (ALL CAPS, bold, e.g., "MUỐI", "XƯƠNG ỐNG", "BÁNH PHỞ")
- Line 2: prep method (mixed case, e.g., "Nêm vừa", "Hầm 6 giờ") — IGNORE
- Line 3: quantity (with units, e.g., "1.5kg", "2 lít") — IGNORE

Return ONLY the Line 1 ingredient name from each callout. Do NOT include prep methods, quantities, the dish title at the bottom (e.g., "PHỞ BÒ"), or the tagline.

If the same ingredient name appears in more than one callout, list it more than once (preserve duplicates).

For reference, the expected ingredient names are (you don't need to match these exactly — list what you ACTUALLY see):
${expectedLabels.map((l) => `  • ${l}`).join('\n')}

Respond ONLY with strict JSON in this exact shape (no markdown, no prose):
{"labels": ["INGREDIENT_NAME_1", "INGREDIENT_NAME_2", "..."]}`;

const callGeminiVision = async (
  apiKey: string,
  model: string,
  imageBuf: Buffer,
  prompt: string,
): Promise<string> => {
  const body = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: 'image/png', data: imageBuf.toString('base64') } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json' },
  };
  const r = await fetch(ENDPOINT(model), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 400);
    throw new Error(`vision_verify_http_${r.status}: ${txt}`);
  }
  const j = (await r.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const txt = j.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
  if (!txt) throw new Error('vision_verify_empty_response');
  return txt;
};

const parseLabels = (raw: string): string[] => {
  let txt = raw.trim();
  if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(txt) as { labels?: unknown };
  if (!Array.isArray(parsed.labels)) throw new Error(`vision_verify_bad_shape: ${txt.slice(0, 200)}`);
  return parsed.labels.filter((x): x is string => typeof x === 'string');
};

const diffSets = (expected: string[], detected: string[]) => {
  const normExp = expected.map(norm);
  const normDet = detected.map(norm);

  const detCount = new Map<string, number>();
  for (const d of normDet) detCount.set(d, (detCount.get(d) ?? 0) + 1);

  const duplicates: string[] = [];
  const detUnique = new Set<string>();
  for (const [label, count] of detCount) {
    if (count > 1) duplicates.push(label);
    detUnique.add(label);
  }

  const missing = normExp.filter((e) => !detUnique.has(e));
  const expSet = new Set(normExp);
  const extra = [...detUnique].filter((d) => !expSet.has(d));

  return { duplicates, missing, extra };
};

export const verifyLabels = async (
  apiKey: string,
  imagePath: string,
  expectedLabels: string[],
  opts: VerifyOptions = {},
): Promise<VerifyResult> => {
  const tolerance = opts.tolerance ?? 1;
  const model = opts.model ?? VERIFY_MODEL;
  const buf = await readFile(imagePath);
  const prompt = buildVerifyPrompt(expectedLabels);

  const raw = await withRetry(() => callGeminiVision(apiKey, model, buf, prompt), {
    label: 'vision_verify',
    attempts: 4,
    baseMs: 2000,
    retryOn: [429, 500, 502, 503, 504],
  });
  let detectedLabels: string[];
  try {
    detectedLabels = parseLabels(raw);
  } catch (err) {
    logger.warn('vision_verify_parse_failed', { error: String(err).slice(0, 200) });
    return {
      detectedLabels: [],
      duplicates: [],
      missing: expectedLabels.map(norm),
      extra: [],
      isAcceptable: false,
      mismatchCount: expectedLabels.length,
    };
  }

  const { duplicates, missing, extra } = diffSets(expectedLabels, detectedLabels);
  const mismatchCount = duplicates.length + missing.length + extra.length;
  const isAcceptable = mismatchCount <= tolerance;

  logger.info('vision_verify_done', {
    expected: expectedLabels.length,
    detected: detectedLabels.length,
    duplicates: duplicates.length,
    missing: missing.length,
    extra: extra.length,
    isAcceptable,
  });

  return { detectedLabels, duplicates, missing, extra, isAcceptable, mismatchCount };
};
