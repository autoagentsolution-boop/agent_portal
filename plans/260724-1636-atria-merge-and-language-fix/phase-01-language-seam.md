# Phase 01 — LLM-authoritative content language

## Root cause (script-10)
`detect-language.ts:36` `VI_DIACRITICS` fires on a SINGLE accented char. A VN brand name ("Nắng Sớm")
in a 20-word Spanish message → `detectLanguage` returns 'vi' → `contentLanguageFor` rule 1 returns 'vi'
BEFORE the model's declaration is ever consulted → whole reply + flow content in Vietnamese.

The regex/detection is authoritative OVER the model. User: the model reads the whole message and knows a
VN proper noun in a Spanish sentence isn't a VN message — let IT decide; regex is a backup.

## Current contract encoded in verify-master.ts:279-302 (must be reworked deliberately)
- 296/297 declared vi/th on an English msg → REFUSED → en   (memory-bleed guard)
- 301 VN msg + declared 'en' → detection wins → vi           (detection corrects a wrong declaration)
- 302 'proceed', prior 'id', declared 'en' → prior → id      (a bare confirm must not re-decide language)
- 283 'thêm ảnh nữa', prior 'en' → detection overrides prior → vi
- 289-293 declared id/fr/es/en (+es-MX) on Latin msgs → declared

## Two ambition levels

### Option MIN — fix the false positive only (KISS, zero protection regressions)
Make VN detection PROPORTIONAL: fire 'vi' only when VN-marked tokens are a real share of the message
(e.g. ≥30% of tokens, or ≥2 distinct VN tokens AND that share), so a lone brand name can't flip it.
`contentLanguageFor` priority unchanged. Script-10: detect→null → prior(null) → `latinDeclared('es')`
→ 'es' (or worst-case 'en', never the wrong 'vi'). ALL of 279-302 stay green; add a script-10 case.
- Pro: minimal, safe, solves the observed bug. Con: doesn't make the model *authoritative* — regex still
  wins for a true VN detection (which is correct behavior, just not the philosophy the user stated).

### Option FULL — LLM-authoritative reorder (honors the stated philosophy)
New priority: `detectScript(non-Latin, ground truth)` → `detectVietnamese(proportional, strong)` →
`prior` → `declared(model)` → `en`. Plus the MIN false-positive fix. The model decides every
Latin-ambiguous FIRST turn (script-10 'es'); a genuine non-Latin/VN message is still ground-truthed; an
established flow's prior holds a bare confirm (302 preserved); a VN refine still overrides (283 preserved).
Test deltas: **296/297 → now return the declared code** (vi/th) instead of en — we TRUST the model, which
the message_language prompt already tells to ignore recalled context; this is the memory-bleed guard the
user is explicitly retiring. 301 stays 'vi' (VN detection above declared). Add script-10 regression.
- Pro: matches "let the LLM return the chat's primary language". Con: retires the 296/297 memory-bleed
  guard — a mis-declaration is now trusted (low risk: the prompt already says ignore-context).

## Recommendation
Option FULL, because it's what the user asked for AND, with the proportional VN fix + non-Latin-script
ground-truth kept, the only thing actually retired is the 296/297 defensive refusal — which existed only
because the old author didn't trust the model to ignore memory. The prompt already instructs that.

## Files
- `src/orchestration/master/detect-language.ts` — proportional VN detection; (FULL) reorder
  `contentLanguageFor`; keep base-subtag normalize + code-format validity.
- `src/orchestration/verify-master.ts` — rework 279-302 to the chosen contract + add script-10 case
  (`contentLanguageFor('Planifica ... Nắng Sớm ...', null, 'es') === 'es'`). Pin so a regression fails CI.

## Success
verify-master green under the new contract; the script-10 case passes; live re-test of the ES request
(with a VN-diacritic brand name) replies in Spanish.
