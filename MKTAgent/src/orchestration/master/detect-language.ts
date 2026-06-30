// Reply-language detector. The conversation author needs to answer in the user's
// language, but the analyzer's parseLanguage only fires on an EXPLICIT mention
// ("tiếng Việt" / "in English"). A plain message like "Write a short LinkedIn post"
// or "đăng bài bán hàng mỗi ngày" carries no such marker, so we infer from the script:
// Vietnamese diacritics (or common unaccented VN function words) → 'vi', else 'en'.
//
// Deterministic + dependency-free so the author's voice stays consistent with no LLM,
// and the verify scripts can assert it. An explicit goal.slots.language (from the
// analyzer) always wins over this heuristic — see authorContext in conversation-author.

// Vietnamese-specific letters (precomposed + the đ). Their presence is a strong,
// near-zero-false-positive signal of Vietnamese.
const VI_DIACRITICS = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;

// Common unaccented Vietnamese function words — covers users who type without accents
// ("toi muon dang bai ban hang"). Whole-word matched to avoid English collisions.
const VI_WORDS = /\b(toi|minh|ban|muon|lam|cho|cua|va|moi|ngay|san pham|dich vu|quang cao|dang bai|gium|giup|thuong hieu)\b/i;

export type ReplyLanguage = 'vi' | 'en';

// Detect the reply language from a raw user message. Defaults to 'en' (the product's
// base language) when no Vietnamese signal is present.
export const detectLanguage = (message: string): ReplyLanguage => {
  const m = message ?? '';
  if (VI_DIACRITICS.test(m)) return 'vi';
  if (VI_WORDS.test(m)) return 'vi';
  return 'en';
};

// Map a language code (explicit goal.slots.language OR a detected one) to the human
// name the prompt instructs the model to write in.
export const languageName = (code: string | null | undefined): string => {
  switch ((code ?? '').toLowerCase()) {
    case 'vi': return 'Vietnamese';
    case 'th': return 'Thai';
    case 'en': return 'English';
    default: return 'English';
  }
};
