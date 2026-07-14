// Product-knowledge extraction from user-uploaded documents. The Master Agent's copy +
// image/video prompts are only as good as the product knowledge they're grounded in; a bare
// name yields generic media. Here the user uploads real material (a deck, a spec sheet, a
// product photo) and Gemini's multimodal model reads it into a rich, factual product profile.
//
// Transport: documents arrive as base64 (no multipart dep; Gemini inlineData wants base64).
// PDFs + images go in as inlineData; text/markdown as a text part. Cost uses REAL usageMetadata
// (the document tokens are counted) — the first real-token plumbing in the codebase.
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { productKnowledgeSystemPrompt } from './analysis-prompt.ts';
import { estimateLlmCost, type NodeCost } from '../orchestration/executor/node-cost.ts';
import { recordGeminiCall } from '../cost/llm-usage.ts';

// gemini-2.5-flash text pricing (mirror node-cost.ts constants — media tokens bill as input).
const TEXT_INPUT_PER_M = 0.30;
const TEXT_OUTPUT_PER_M = 2.50;

// Gemini reads these natively. DOCX is intentionally excluded (needs a text extractor) — the
// router rejects it with a clear message rather than sending bytes the model can't parse.
export const SUPPORTED_MIME = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp',
  'text/plain', 'text/markdown',
]);

export interface UploadedDoc {
  name: string;
  mimeType: string;
  dataB64: string;
}

export interface ProductProfile {
  productSummary: string;   // what it is / does — comprehensive, factual
  differentiators: string;  // what makes it distinct
  targetAudience: string;   // who it's for
  proofPoints: string;      // claims/evidence found IN the docs (not invented)
  brandVoice: string;       // tone/voice if evident, else ''
  language: string;         // detected doc language code/label, else ''
}

export interface AnalysisResult {
  profile: ProductProfile;
  // One rich paragraph composed from the profile — what fills goal.slots.productDetails /
  // campaign.brandContext and grounds every downstream prompt.
  productDetails: string;
  brandVoice: string | null;
  language: string | null;
  cost: NodeCost;
}

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

// base64 → rough decoded byte length (each 4 b64 chars ≈ 3 bytes), for the text-decode of
// text/* parts without pulling the whole thing into a Buffer twice.
const decodeText = (b64: string): string => Buffer.from(b64, 'base64').toString('utf8');

const buildParts = (docs: UploadedDoc[], product?: string): unknown[] => {
  const parts: unknown[] = [];
  for (const d of docs) {
    if (d.mimeType.startsWith('text/')) {
      parts.push({ text: `--- Document: ${d.name} ---\n${decodeText(d.dataB64).slice(0, 200_000)}` });
    } else {
      parts.push({ inlineData: { mimeType: d.mimeType, data: d.dataB64 } });
    }
  }
  parts.push({
    text: `The product/brand is${product ? ` "${product}"` : ' described in the attached material'}. `
      + `Read ALL attached documents/images and extract the product knowledge as JSON. `
      + `Use ONLY facts present in the material — never invent capabilities, audience, or claims.`,
  });
  return parts;
};

const composeDetails = (p: ProductProfile): string =>
  [p.productSummary, p.differentiators && `Differentiators: ${p.differentiators}`,
   p.targetAudience && `Audience: ${p.targetAudience}`, p.proofPoints && `Proof: ${p.proofPoints}`]
    .filter(Boolean).join(' ').trim();

const costFromUsage = (raw: unknown, fallbackIn: string, fallbackOut: string): NodeCost => {
  const usage = (raw as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
  if (!usage?.promptTokenCount) return estimateLlmCost(fallbackIn, fallbackOut);
  const promptTokens = usage.promptTokenCount;
  const outputTokens = usage.candidatesTokenCount ?? 0;
  return {
    promptTokens,
    outputTokens,
    totalTokens: promptTokens + outputTokens,
    costUsd: (promptTokens / 1_000_000) * TEXT_INPUT_PER_M + (outputTokens / 1_000_000) * TEXT_OUTPUT_PER_M,
  };
};

const extractText = (raw: unknown): string =>
  (raw as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// Extract the RAW text of uploaded documents/images (for the summarize + security flow — NOT a product
// profile). Reuses the same multimodal transport (PDF/image → inlineData, text/* inline). Gemini transcribes
// verbatim; the security node masks any personal/sensitive data downstream. Throws on missing key / bad
// response (router maps to 4xx/5xx). No product framing — this is a general document-to-text primitive.
export interface ExtractionResult { text: string; cost: NodeCost }

const EXTRACT_PROMPT =
  'Transcribe ALL text content from the attached document(s)/image(s) COMPLETELY and verbatim, preserving '
  + 'the reading order and structure (headings, paragraphs, lists, tables as readable text). Do NOT summarize, '
  + 'omit, translate, or add commentary. Output ONLY the extracted text.';

export const extractDocumentText = async (
  docs: UploadedDoc[],
  ownerId?: string | null,
): Promise<ExtractionResult> => {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY required for document extraction');
  if (docs.length === 0) throw new Error('no documents provided');

  const parts: unknown[] = [];
  for (const d of docs) {
    if (d.mimeType.startsWith('text/')) parts.push({ text: `--- ${d.name} ---\n${decodeText(d.dataB64).slice(0, 200_000)}` });
    else parts.push({ inlineData: { mimeType: d.mimeType, data: d.dataB64 } });
  }
  parts.push({ text: EXTRACT_PROMPT });

  const res = await fetch(endpoint(env.GEMINI_MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0 } }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`gemini_extract_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const raw = await res.json();
  await recordGeminiCall(raw, { ownerId: ownerId ?? null, surface: 'doc_extract', model: env.GEMINI_MODEL });
  const text = extractText(raw).trim().slice(0, 200_000);
  if (!text) throw new Error('no text could be extracted from the document');
  const cost = costFromUsage(raw, JSON.stringify(parts).slice(0, 2000), text);
  logger.info('doc_text_extracted', { docs: docs.length, chars: text.length, tokens: cost.totalTokens });
  return { text, cost };
};

// Analyze uploaded documents into a product profile. Throws on a missing key or an unusable
// model response (the router maps it to a 4xx/5xx) — callers must handle it.
// ownerId/refId (optional): the authenticated tenant + a knowledge/campaign id to tag the
// ledger row with, threaded from product-knowledge-router.ts (surface 'product_analysis').
export const analyzeDocuments = async (
  docs: UploadedDoc[],
  product?: string,
  ownerId?: string | null,
  refId?: string | null,
): Promise<AnalysisResult> => {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY required for document analysis');
  if (docs.length === 0) throw new Error('no documents provided');

  const parts = buildParts(docs, product);
  const res = await fetch(endpoint(env.GEMINI_MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: productKnowledgeSystemPrompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`gemini_analyze_${res.status}: ${(await res.text()).slice(0, 300)}`);

  const raw = await res.json();
  // Ledger the REAL physical call (product_analysis surface) — best-effort, never throws.
  // Fires regardless of downstream parse success below (the call happened and billed either way).
  await recordGeminiCall(raw, { ownerId: ownerId ?? null, surface: 'product_analysis', model: env.GEMINI_MODEL, refId: refId ?? null });
  const text = extractText(raw);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
  } catch {
    throw new Error('document analysis returned an unreadable response');
  }

  const profile: ProductProfile = {
    productSummary: s(parsed.productSummary),
    differentiators: s(parsed.differentiators),
    targetAudience: s(parsed.targetAudience),
    proofPoints: s(parsed.proofPoints),
    brandVoice: s(parsed.brandVoice),
    language: s(parsed.language),
  };
  if (!profile.productSummary) throw new Error('no product knowledge could be extracted from the documents');

  const productDetails = composeDetails(profile);
  const cost = costFromUsage(raw, JSON.stringify(parts), text);
  logger.info('product_knowledge_analyzed', { docs: docs.length, tokens: cost.totalTokens, costUsd: cost.costUsd });

  return {
    profile,
    productDetails,
    brandVoice: profile.brandVoice || null,
    language: profile.language || null,
    cost,
  };
};
