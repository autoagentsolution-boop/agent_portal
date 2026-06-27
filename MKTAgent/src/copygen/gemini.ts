// Gemini Flash HTTP client. Auth = ?key= query param (matches the n8n node).
// Returns the raw response JSON; parse.ts turns it into copy variants.
import { env } from '../config/env.ts';
import { withRetry } from '../lib/retry.ts';
import type { GeminiRequestBody } from './prompt.ts';

const TIMEOUT_MS = 60_000;

export async function callGemini(body: GeminiRequestBody): Promise<unknown> {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent` +
    `?key=${env.GEMINI_API_KEY}`;

  const res = await withRetry(
    () =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    { label: 'gemini_copygen' },
  );

  // Return the JSON regardless of status; parse.ts surfaces upstream errors with
  // the real Gemini message (mirrors the n8n continueErrorOutput branch).
  return res.json();
}
