// Reply-language hint. The conversation author must answer in the user's language —
// ANY language, not just vi/en. The authoritative signal is the LLM itself reading the
// user's actual message (it distinguishes French from English, Thai from Lao, etc. —
// things a regex cannot). This module is the BACKUP: a script/diacritic heuristic that
// gives a confident code when the writing system is unambiguous, and `null` when it
// can't tell (most Latin-script languages) so the caller defers to the model.
//
// Used two ways: (1) a hint passed to the LLM alongside the raw message; (2) the only
// signal on the no-LLM deterministic fallback path. Deterministic + dependency-free.

// Unicode-block probes — presence of a script is a near-zero-false-positive language
// signal. Ordered most-specific first. Latin scripts are intentionally NOT here: they
// cannot be told apart by codepoint (en/fr/es/de/… all share Latin), so we return null
// and let the model mirror the user's message.
const SCRIPT_PROBES: Array<[code: string, re: RegExp]> = [
  ['ja', /[぀-ゟ゠-ヿ]/],           // Hiragana/Katakana (Japanese-specific)
  ['ko', /[가-힯ᄀ-ᇿ]/],           // Hangul
  ['zh', /[一-鿿]/],                         // Han (after ja/ko so kana/hangul win)
  ['th', /[฀-๿]/],                         // Thai
  ['ru', /[Ѐ-ӿ]/],                         // Cyrillic
  ['ar', /[؀-ۿ]/],                         // Arabic
  ['he', /[֐-׿]/],                         // Hebrew
  ['hi', /[ऀ-ॿ]/],                         // Devanagari
  ['el', /[Ͱ-Ͽ]/],                         // Greek
];

// DISTINCTIVELY-Vietnamese Latin letters only. Plain accents (à á è é ì í ò ó ù ú â ê ô
// grave/acute) are shared with French/Spanish/Italian, and the bare tildes ã õ with
// Portuguese — matching any of those misfires (e.g. French "fonctionnalité", Portuguese
// "São"). What remains is essentially unique to Vietnamese: đ, the horn vowels (ơ ư +
// tones), the breve a (ă + tones), and vowels carrying a dot-below or a hook-above tone,
// which those European languages do not use.
// Includes the stacked-tone vowels (circumflex/breve/horn + grave or acute — ầấằắềếồốờớừứ)
// which are distinctively Vietnamese: French/Spanish/Portuguese never stack a tone on a
// modified vowel, so these are near-zero false positive.
const VI_DIACRITICS = /[đăơưạảặẳẵậẩẫầấằắẹẻệểễềếịỉọỏộổỗồốợởỡờớụủựửữừứỳỵỷ]/i;
// Common unaccented Vietnamese function words — covers users typing VN without accents.
// GLOBAL so we can COUNT distinct hits: bare tokens like "ban", "cho", "va", "moi", "lam"
// also appear in English text and product/brand names, so a SINGLE hit is not enough to
// call a message Vietnamese (that false-positive flipped English flows to VN). Require ≥2
// distinct hits; accented VN (VI_DIACRITICS) remains a confident single-hit signal.
const VI_WORDS = /(?<![\p{L}])(toi|minh|ban|muon|lam|cho|cua|va|moi|ngay|san pham|dich vu|quang cao|dang bai|gium|giup|thuong hieu)(?![\p{L}])/giu;

// Detect a language code from a raw message, or null when the script is Latin and
// ambiguous (caller should defer to the LLM mirroring the message). Covers the major
// non-Latin scripts + Vietnamese; everything else → null (NOT assumed English).
export const detectLanguage = (message: string): string | null => {
  const m = message ?? '';
  // Non-Latin scripts first — presence of the script is near-zero-false-positive ground truth.
  for (const [code, re] of SCRIPT_PROBES) {
    if (re.test(m)) return code;
  }
  // Vietnamese is Latin-script, so detect it PROPORTIONALLY and only on LOWERCASE evidence. A brand /
  // proper noun like "Nắng Sớm" dropped into a foreign sentence is Capitalized; genuine Vietnamese prose
  // carries its VN-diacritic words in lower case. Counting only lowercase-initial diacritic tokens keeps a
  // Capitalized brand from flipping the whole message to Vietnamese (the false positive that replied in VN
  // to a Spanish chat) while still catching real VN text.
  const tokens = m.trim().split(/\s+/).filter(Boolean);
  if (tokens.length) {
    const vnLower = tokens.filter((t) => VI_DIACRITICS.test(t) && !/^[\p{Lu}]/u.test(t)).length;
    if (vnLower >= 2 && vnLower / tokens.length >= 0.3) return 'vi';
    if (vnLower >= 1 && tokens.length <= 3) return 'vi'; // a short, clearly-VN phrase
  }
  // Unaccented VN: ≥2 DISTINCT function words (a single bare token also appears in English/brand names).
  const viHits = new Set((m.toLowerCase().match(VI_WORDS) ?? []).map((w) => w.trim())).size;
  if (viHits >= 2) return 'vi';
  return null; // Latin / undetermined → let the model's declaration decide (see contentLanguageFor).
};

// Human-readable language name for a code (BCP-47-ish). Falls back to the raw code so
// an unmapped-but-valid code still reaches the prompt as a usable instruction.
const NAMES: Record<string, string> = {
  vi: 'Vietnamese', en: 'English', th: 'Thai', ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', ru: 'Russian', ar: 'Arabic', he: 'Hebrew', hi: 'Hindi',
  el: 'Greek', fr: 'French', es: 'Spanish', de: 'German', pt: 'Portuguese',
  it: 'Italian', id: 'Indonesian', ms: 'Malay', tl: 'Filipino', km: 'Khmer',
  lo: 'Lao', my: 'Burmese',
};

export const languageName = (code: string | null | undefined): string | null => {
  const c = (code ?? '').toLowerCase();
  if (!c) return null;
  return NAMES[c] ?? code ?? null;
};

// Normalize a model-declared language to a bare, valid code. Models answer 'id' but also 'id-ID' /
// 'pt-BR', and downstream prompts want the base subtag; anything that isn't a 2-3 letter code (e.g. the
// model spelling out "Indonesian") is rejected as unusable. NO script-based reject: the model reads the
// actual words and is TRUSTED for its declaration — the message_language prompt already tells it to
// ignore any recalled background context, which is what a codepoint reject used to (bluntly) guard.
const declaredCode = (declared: string | null | undefined): string | null => {
  const code = (declared ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return /^[a-z]{2,3}$/.test(code) ? code : null;
};

// The authoritative CONTENT language for a run. The user always opens with a message (or voice → text)
// that passes through the conversational brain, so the MODEL's read of that first message is the primary
// signal — it distinguishes Spanish-with-a-VN-brand-name from actual Vietnamese, which a codepoint
// heuristic cannot. Priority:
//   1. The flow's ESTABLISHED prior language (set on the FIRST chat) persists — a later confirm/refine
//      does not re-decide it. `prior` MUST be ctx.priorGoal, NEVER the analyzer's memory-fillable slot.
//   2. First turn (no prior) → the language the MODEL declared for THIS message (`declared`).
//   3. No model signal (deterministic/no-LLM path) → the detection heuristic as a FALLBACK.
//   4. Nothing usable → English, never the VN account default.
// A per-node form field / explicit form override still wins upstream of this.
export const contentLanguageFor = (message: string, prior: string | null | undefined, declared?: string | null): string => {
  const priorCode = (prior ?? '').trim().toLowerCase();
  if (priorCode) return priorCode;
  return declaredCode(declared) ?? detectLanguage(message) ?? 'en';
};

// ── Reply language (the language Atria's CHAT reply is written in) ──────────────────────────────────
// Distinct from contentLanguageFor (the language generated POSTS/emails use). The reply must mirror the
// language the user is TYPING, not the language of their product/brand or the recalled memory context.
// The bug this fixes: an English message that merely names a Vietnamese brand ("Nắng Sớm") plus a bulky
// Vietnamese memory block dragged the whole reply into Vietnamese, because the only signal was
// detectLanguage(message) (→ null for a Capitalized brand) followed by a soft one-line hint that the
// closer, heavier VN context out-weighed. Same LLM-authoritative philosophy as content, applied to reply:
//   1. The flow's ESTABLISHED prior language holds — a bare "proceed"/"đúng vậy" must not re-decide it.
//   2. Else a CONFIDENT script/VN detection of THIS message (non-Latin ground truth, or real VN prose).
//   3. Else null → the caller tells the model to mirror the SENTENCE and ignore background/brand language.
// Account/UI default is deliberately NOT consulted here: a reply mirrors what the user is writing now, not
// their saved default (that default is only content's LAST-resort fallback). See feedback_reply_language_pin.
export interface ReplyLanguage { code: string | null; name: string | null }
export const replyLanguageHint = (message: string, prior?: string | null): ReplyLanguage => {
  const priorCode = (prior ?? '').trim().toLowerCase();
  if (priorCode && /^[a-z]{2,3}$/.test(priorCode)) return { code: priorCode, name: languageName(priorCode) };
  const detected = detectLanguage(message);
  return { code: detected, name: languageName(detected) };
};

// Cheap, dependency-free "does this text read as Vietnamese?" for the reply self-check (NOT a language
// decision — just a mismatch probe). Fires on real VN evidence: ≥2 lowercase VN-diacritic tokens, or ≥2
// distinct unaccented VN function words. A lone Capitalized brand ("Nắng Sớm") does NOT trip it (mirrors
// detectLanguage's proportional rule), so an English reply that merely quotes a VN brand is not flagged.
export const looksVietnamese = (text: string): boolean => {
  const t = text ?? '';
  const tokens = t.trim().split(/\s+/).filter(Boolean);
  const vnLower = tokens.filter((tok) => VI_DIACRITICS.test(tok) && !/^[\p{Lu}]/u.test(tok)).length;
  if (vnLower >= 2) return true;
  const viHits = new Set((t.toLowerCase().match(VI_WORDS) ?? []).map((w) => w.trim())).size;
  return viHits >= 2;
};
