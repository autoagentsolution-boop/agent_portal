// Explicit Gemini context cache for the Atria brain's STATIC prefix — the system prompt + tool
// declarations (~1.4k tokens) that are re-sent on EVERY brain round. Implicit caching does not hit here
// (measured cachedContentTokenCount=0), so we cache explicitly: create ONE CachedContent, then reference
// it by name in generateContent (omitting the prompt + tools) so Gemini bills that prefix at the cached
// rate instead of full price every round.
//
// Best-effort by design: any failure returns null and the brain falls back to sending the prefix inline
// (unchanged behavior), so caching can NEVER break a turn. Auto-invalidates when the prompt/tools content
// changes (content hash — survives a deploy that edits the prompt) or when the TTL nears expiry.
import { createHash } from 'node:crypto';
import { env } from '../../config/env.ts';
import { atriaBrainSystemPrompt } from '../prompts/atria-brain-prompt.ts';
import { TOOL_DECLARATIONS } from './atria-tools.ts';

const TTL_SECONDS = 3600; // 1h server-side cache lifetime
const REFRESH_MARGIN_MS = 5 * 60_000; // treat as expired 5 min early so a call never races the TTL

interface CacheHandle { name: string; expireAt: number; hash: string }
let handle: CacheHandle | null = null;
let inflight: Promise<CacheHandle | null> | null = null;

// A short fingerprint of everything baked into the cache — if the prompt, the tools, or the model change,
// the hash changes and a fresh cache is created (the old one just expires server-side on its own TTL).
const staticHash = (): string =>
  createHash('sha256')
    .update(atriaBrainSystemPrompt)
    .update(JSON.stringify(TOOL_DECLARATIONS))
    .update(env.GEMINI_MODEL)
    .digest('hex')
    .slice(0, 16);

const createCache = async (hash: string): Promise<CacheHandle | null> => {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${env.GEMINI_MODEL}`,
        systemInstruction: { parts: [{ text: atriaBrainSystemPrompt }] },
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        ttl: `${TTL_SECONDS}s`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null; // e.g. below the min-token threshold → caller sends the prefix inline
    const j = (await res.json()) as { name?: string };
    return j.name ? { name: j.name, expireAt: Date.now() + TTL_SECONDS * 1000, hash } : null;
  } catch {
    return null;
  }
};

// A valid cached-content name for the brain's static prefix, or null (→ send inline). Lazily creates /
// refreshes; a single in-flight promise de-dupes concurrent first-hits so we don't create N caches.
export async function getBrainCache(): Promise<string | null> {
  if (!env.GEMINI_API_KEY) return null;
  const hash = staticHash();
  if (handle && handle.hash === hash && handle.expireAt - Date.now() > REFRESH_MARGIN_MS) return handle.name;
  if (inflight) return (await inflight)?.name ?? null;
  inflight = createCache(hash).then((h) => { handle = h; inflight = null; return h; });
  return (await inflight)?.name ?? null;
}

// Drop the cached handle — called when a cached generateContent fails (likely a stale/evicted cache) so
// the next turn recreates it.
export function invalidateBrainCache(): void {
  handle = null;
}
