// Gemini request builder (T3 — config-as-data + language-agnostic).
//
// The GUARDRAILS are the proven asset, ported verbatim from the n8n "Build Gemini
// request" node (hook ≤50 chars, no HTML/markdown, banned clichés, threads ≤480,
// x ≤280, conditional lead-form CTA). What T3 changes:
//   • language is RESOLVED (post → campaign → user) and ALL variants generate in
//     that language — the old "Threads/X always English" rule is dropped.
//   • brand persona is OPTIONAL: business (brandVoice present) → company voice;
//     personal (null) → a human sharing, no brand persona, no forced #brand tags.
//   • output is a 3-variant bag { body, threads, x } (was copyVi/En/Threads/X).
import type { PostWithCampaignOwner } from '../db/repos/post-repo.ts';
import { resolveCopyConfig, type ResolvedCopyConfig } from './resolve-config.ts';

export interface GeminiRequestBody {
  systemInstruction: { parts: Array<{ text: string }> };
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  generationConfig: Record<string, unknown>;
}

// length keyword/raw-count → human length spec. Kept language-neutral (word count
// is universal); the model writes the count in the target language naturally.
export function lengthSpecFor(lengthRaw: string): string {
  const l = lengthRaw.trim().toLowerCase();
  if (!l) return 'about 130-220 words';
  if (['short', 'ngắn', 'ngan'].includes(l)) return 'concise, about 80-130 words';
  if (['medium', 'vừa', 'vua'].includes(l)) return 'about 130-220 words';
  if (['long', 'dài', 'dai'].includes(l)) return 'long, about 220-320 words';
  if (/^\d+$/.test(l)) return `about ${l} words (±15% allowed)`;
  return 'about 130-220 words';
}

// Persona line: business uses the resolved brand voice/context; personal omits any
// company persona. Returned as an array of system lines spliced into the prompt.
function personaLines(cfg: ResolvedCopyConfig): string[] {
  if (cfg.brandVoice) {
    const who = cfg.brandName ? `${cfg.brandName}` : 'the brand';
    return [
      `You are a social-media copywriter for ${who}. Brand voice: ${cfg.brandVoice}.`,
      cfg.brandContext ? `Brand context (facts you may use, do not invent beyond these): ${cfg.brandContext}.` : '',
      'Write ONE high-engagement Facebook/Threads post. Write like a HUMAN sharing, NOT a brand advertising.',
    ].filter(Boolean);
  }
  // Personal / no-brand: human sharing, no company persona, no forced brand hashtags.
  return [
    'You are a real person sharing a genuine post on social media — NOT a brand, NOT an advertiser.',
    'Write ONE high-engagement Facebook/Threads post in a natural, personal voice. No company persona.',
  ];
}

// Optional refine directive: an instruction to tweak the EXISTING copy in place
// (text-refine, not a from-scratch rework). Threaded into the user message so the
// model edits the current variants rather than regenerating blindly.
export interface RefineDirective {
  instruction: string;
  current: { body: string; threads: string; x: string };
}

export function buildGeminiBody(post: PostWithCampaignOwner, refine?: RefineDirective): GeminiRequestBody {
  const product = (post.campaign.product ?? '').trim();
  // Post-level angle overrides the campaign's (per-post strategy).
  const angle = (post.angle ?? post.campaign.angle ?? '').trim();
  const leadsForm = (post.campaign.leadsForm ?? '').trim();
  const feedback = (post.feedback ?? '').trim();
  const isRework = post.status === 'rework';
  if (!product) throw new Error('mkt_copygen: campaign missing product');

  const cfg = resolveCopyConfig(post);
  const lengthSpec = lengthSpecFor(cfg.lengthRaw);
  const lang = cfg.language;
  const hashtagRule = cfg.brandVoice
    ? `end with 4-6 hashtags${cfg.brandName ? ` starting with #${cfg.brandName.replace(/\s+/g, '')}` : ''}`
    : 'end with 2-4 relevant, natural hashtags (no forced brand tags)';

  const system = [
    ...personaLines(cfg),
    `LANGUAGE: write EVERY variant (body, threads, x) in ${lang}. Do not mix languages; keep it natural and idiomatic in ${lang}.`,
    'FORMAT (hard guardrail): NO HTML/markdown (no <br>, <b>, **). Real newlines only to separate lines. Short sentences (<20 words). Generous blank lines between lines for mobile readability.',
    `STRUCTURE for "body": first-line HOOK MAX 50 CHARACTERS (including emoji & punctuation) — a concrete number/situation, a contrarian line, or a pain admission; no rambling, no product name in the hook. Then: blank line; a deeper re-hook; blank line; 2-3 emoji-led body lines about the real human/operational RESULT (not a feature list); blank line; 1 closing line; 1 SPECIFIC discussion question (avoid "what do you think?"); 1 single CTA; final line ${hashtagRule}.`,
    `LENGTH: body ${lengthSpec}. 4-6 emojis total. Strictly avoid empty buzzwords ("breakthrough solution", "discover", "game changer", "take it to the next level", "instantly optimize"). Do NOT fabricate stats/percentages/numbers not in the brief; no over-promising.`,
    'SEPARATE THREADS VARIANT ("threads"): write a STANDALONE shortened version, MAX 480 characters (target 300-450). Do NOT truncate the body — rewrite: 1 strong hook ≤50 chars, 1-2 body lines on the result, 1 closing line + 1 CTA, 2-3 hashtags. Must stand alone as a complete post — no cut-off sentences, no missing CTA.',
    'SEPARATE X/TWITTER VARIANT ("x"): write ONE standalone tweet, MAX 280 CHARACTERS (incl. emoji/hashtags) — MUST NOT exceed 280. 1 hook ≤50 chars, 1 value line, 1 short CTA (e.g. "link in bio"), 1-2 hashtags. Do NOT put a real URL in the text (X penalizes link posts). Standalone, no cut-off.',
    'BRIEF PRIORITY: if the "angle" carries its own layout/tone/storytelling/emphasis request → FOLLOW that brief (flex the base structure) as long as the hard guardrails hold (no HTML, hook ≤50 chars, avoid buzzwords, correct length). Angle outranks the base structure.',
  ];
  if (leadsForm) {
    system.push(
      `LEAD FORM LINK: this post has a lead-capture form = ${leadsForm}. In the CTA of "body" AND "threads", use EXACTLY this link (write the full URL) as the call to sign up / leave info — do NOT use "link in bio" for those two. "threads" must still be ≤480 chars INCLUDING the link (trim the body to make room, no cut-off). For "x" ONLY: NEVER insert a real URL (X penalizes links) — keep "link in bio". One CTA per variant, no link spam.`,
    );
  }
  const systemText = system.join('\n');

  let user = `Product/service: ${product}\nAngle: ${angle || '(choose a fitting angle, emphasize the real operational benefit)'}\nWrite the body, threads, and x variants — all in ${lang}.`;
  if (refine) {
    // Text-refine: keep the existing copy and apply a targeted edit. This preserves the
    // audit trail (all copy changes go through the LLM, never a raw hand-edit) while
    // giving the user precise control over small tweaks.
    user += `\n\nThis is a TARGETED REFINEMENT of existing approved copy — do NOT rewrite from scratch. Apply ONLY this change: "${refine.instruction}". Keep everything else (hook strength, structure, CTA, hashtags) intact unless the change requires it. Re-emit all three variants (body, threads, x) with the change applied, honoring every hard guardrail (hook ≤50 chars, threads ≤480, x ≤280, no HTML).`;
    user += `\n\nCURRENT body:\n${refine.current.body}\n\nCURRENT threads:\n${refine.current.threads}\n\nCURRENT x:\n${refine.current.x}`;
  } else if (isRework && feedback) {
    user += `\n\nNOTE: the previous version was REJECTED. Reviewer feedback: "${feedback}". Rewrite to FIX exactly these points; do not repeat the old mistakes.`;
  } else if (isRework) {
    user += `\n\nNOTE: the previous version was rejected (no specific notes). Write a SUBSTANTIALLY DIFFERENT hook and approach.`;
  }

  return {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.95,
      topP: 0.95,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          body: { type: 'STRING' },
          threads: { type: 'STRING' },
          x: { type: 'STRING' },
        },
        required: ['body', 'threads', 'x'],
      },
    },
  };
}
