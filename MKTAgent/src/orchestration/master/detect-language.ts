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
const VI_DIACRITICS = /[đăơưạảặẳẵậẩẫẹẻệểễịỉọỏộổỗợởỡụủựửữỳỵỷ]/i;
// Common unaccented Vietnamese function words — covers users typing VN without accents.
const VI_WORDS = /\b(toi|minh|ban|muon|lam|cho|cua|va|moi|ngay|san pham|dich vu|quang cao|dang bai|gium|giup|thuong hieu)\b/i;

// Detect a language code from a raw message, or null when the script is Latin and
// ambiguous (caller should defer to the LLM mirroring the message). Covers the major
// non-Latin scripts + Vietnamese; everything else → null (NOT assumed English).
export const detectLanguage = (message: string): string | null => {
  const m = message ?? '';
  if (VI_DIACRITICS.test(m) || VI_WORDS.test(m)) return 'vi';
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
