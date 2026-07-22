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
  if (VI_DIACRITICS.test(m)) return 'vi';
  const viHits = new Set((m.toLowerCase().match(VI_WORDS) ?? []).map((w) => w.trim())).size;
  if (viHits >= 2) return 'vi';
  for (const [code, re] of SCRIPT_PROBES) {
    if (re.test(m)) return code;
  }
  return null; // Latin / undetermined → let the model mirror the user's message.
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

// Codes the script probes above (plus Vietnamese, via its diacritics/function words) can identify on
// their own. Used as a REJECT list for the model-declared language: if `detectLanguage` returned null,
// the message provably contains none of these scripts, so a declaration of one contradicts the text and
// is the memory-bleed we deliberately ignore (recalled VN facts making the model claim 'vi' on an
// English chat). Derived from SCRIPT_PROBES so a new probe extends this automatically.
const SCRIPT_DETECTABLE = new Set([...SCRIPT_PROBES.map(([code]) => code), 'vi']);

// A model-declared language is trusted ONLY where the detector is blind: Latin script, no VN markers.
// That is exactly the gap that made Indonesian/Malay/Filipino/French/Spanish/German/Portuguese/Italian
// silently produce English content — the writing system cannot tell them apart, so code must defer to
// the model that actually read the words. Anything the detector could have caught itself is refused.
const latinDeclared = (declared: string | null | undefined): string | null => {
  // Base subtag only — models answer 'id' but also 'id-ID' / 'pt-BR', and downstream prompts want the code.
  const code = (declared ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  if (!/^[a-z]{2,3}$/.test(code) || SCRIPT_DETECTABLE.has(code)) return null;
  return code;
};

// The authoritative CONTENT language for a run — mirrors the language the user is actually communicating
// in, so a memory-inferred 'vi' can't force Vietnamese onto an English (or Thai, …) conversation. Rules:
//   1. A confident detection of the CURRENT message wins (VN/Thai/JP/… by script — kills memory bleed and
//      lets a later refine that states a detectable language override the flow's language).
//   2. Otherwise (Latin/ambiguous message) keep the flow's ESTABLISHED prior language.
//   3. First turn with no prior → the language the MODEL read off this message (`declared`), filtered by
//      latinDeclared so only the Latin-script blind spot is trusted.
//   4. Nothing usable → English (mirror a Latin chat), never the VN account default.
// `prior` MUST be the previously-established goal language (ctx.priorGoal), NEVER the requirement
// analyzer's inferred slot — that one is filled from recalled memory as readily as from the message.
// `declared` is different: it is the conversational brain naming the language of THIS message, the same
// signal it uses to write its own reply — which is why the reply was Indonesian while the copy was
// English. Because turn 1 already resolves via this function, a carried 'vi' can only mean a genuinely
// VN conversation, so keeping it is safe. A per-node form field / explicit form override still wins.
export const contentLanguageFor = (message: string, prior: string | null | undefined, declared?: string | null): string => {
  const detected = detectLanguage(message);
  if (detected) return detected;
  return (prior ?? '').trim().toLowerCase() || latinDeclared(declared) || 'en';
};
