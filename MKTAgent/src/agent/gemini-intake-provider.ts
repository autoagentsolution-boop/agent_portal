import { env } from '../config/env.ts';
import type { AgentIntakeBody, AgentIntakeDraft } from '../api/schemas.ts';
import { DeterministicAgentIntakeProvider, type AgentIntakeProvider } from './intake-provider.ts';
import { recordGeminiCall } from '../cost/llm-usage.ts';

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

const systemPrompt = `You are AgentPortal Master Agent intake.
Return ONLY valid JSON matching this exact shape:
{
  "selectedTemplateId":"branding-video-post",
  "selectedTemplateTitle":"Branding / Social Video Post Flow",
  "confidence":0.0,
  "campaign":{
    "product":"",
    "angle":"",
    "brandContext":"",
    "language":"vi|en|custom label",
    "defaultLength":"short|medium|long|number",
    "platforms":["facebook","instagram","threads","linkedin","x"],
    "brandVoice":"",
    "timezone":"Asia/Bangkok"
  },
  "post":{
    "assetType":"image|carousel|video",
    "language":"vi|en|custom label",
    "lengthSpec":"short|medium|long|number",
    "platforms":["facebook","instagram","threads","linkedin","x"],
    "scheduledAt":"ISO string or null",
    "driveFolderId":"",
    "heroFile":""
  },
  "missingFields":[{"key":"heroFile","label":"Drive media file ID(s)","reason":"...","required":false}],
  "nextQuestion":"",
  "assistantMessage":"natural conversational response to the customer, like ChatGPT/Claude/Gemini; ask thoughtful follow-up questions when the request is broad, and avoid template wording",
  "provider":"gemini"
}
Rules: draft only; never include publish approval. Do not invent proof, credentials, Drive IDs, tokens, or private data. Use null/omit unknown fields. If media is requested without file IDs, add a missing field gate. Choose Branding / Social Video Post Flow for social/video/branding/campaign requests.`;

const parseJson = (raw: unknown): AgentIntakeDraft | null => {
  const text = (raw as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('\n') ?? '';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  if (!cleaned) return null;
  return JSON.parse(cleaned) as AgentIntakeDraft;
};

export class GeminiAgentIntakeProvider implements AgentIntakeProvider {
  constructor(private fallback = new DeterministicAgentIntakeProvider()) {}

  // ownerId (optional): the authenticated tenant, threaded from agent-router.ts so a REAL
  // Gemini call bills the usage ledger (surface 'intake'). No key / no fetch → no record.
  async parse(input: AgentIntakeBody, ownerId?: string | null): Promise<AgentIntakeDraft> {
    if (!env.GEMINI_API_KEY) return this.fallback.parse(input);
    try {
      const res = await fetch(endpoint(env.GEMINI_MODEL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: `Timezone: ${input.timezone}\nUser request:\n${input.message}` }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
      });
      if (!res.ok) return this.fallback.parse(input);
      const raw = await res.json();
      // Ledger the REAL physical call — best-effort, never throws, regardless of whether the
      // JSON parses into a usable draft below (the call happened and billed either way).
      await recordGeminiCall(raw, { ownerId: ownerId ?? null, surface: 'intake', model: env.GEMINI_MODEL });
      const draft = parseJson(raw);
      if (!draft?.campaign || !draft?.post) return this.fallback.parse(input);
      return { ...draft, provider: `gemini:${env.GEMINI_MODEL}` };
    } catch {
      return this.fallback.parse(input);
    }
  }
}
