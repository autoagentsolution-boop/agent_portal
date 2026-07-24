// Concept selection gate UI: the run paused right after concept_writer produced 3-5 versions.
// The user picks their favorite, optionally uploads a reference image, then Continues — which
// resumes the flow (media generation uses the picked version + reference). Reference upload is
// OPTIONAL and never blocks Continue. When there is no downstream media step, the uploaded image
// IS the post media (asHero); otherwise it conditions the infographic/storyboard generation.
import { useRef, useState } from 'react';
import { api } from '../api/client';
import { useLocale } from '../i18n';
import { tError } from '../i18n/t-error';

interface Variant { body: string; threads: string; x: string }

interface Props {
  postId: string;
  variants: Variant[];
  chosen: number;
  hasMediaStep: boolean;
  busy: boolean;
  // Present = the run is PAUSED at the gate (pick + Continue). Absent = REVIEW mode: the run
  // already ran past concept (e.g. after a re-run) — the user can still see + re-pick versions,
  // but there's no Continue-to-approve here (the flow resumes from the main Execute button).
  onContinue?: () => void;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
const MAX_BYTES = 8 * 1024 * 1024;

const toB64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]*;base64,/, ''));
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });

export function ConceptSelectionGate({ postId, variants, chosen, hasMediaStep, busy, onContinue, notify }: Props) {
  const { t } = useLocale();
  const [selected, setSelected] = useState(chosen);
  const [selecting, setSelecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [refName, setRefName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (i: number) => {
    if (i === selected) return;
    setSelected(i);
    setSelecting(true);
    const r = await api.selectVariant(postId, i);
    setSelecting(false);
    if (!r.ok) { notify(tError(r.error), 'err'); return; }
    notify(t('concept.version.selected', { n: i + 1 }));
  };

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) { notify(t('concept.upload.too_large', { name: file.name }), 'err'); return; }
    setUploading(true);
    try {
      const dataB64 = await toB64(file);
      const r = await api.uploadReferenceImage(postId, dataB64, file.type || 'image/png', !hasMediaStep);
      if (!r.ok) { notify(tError(r.error), 'err'); return; }
      setRefName(file.name);
      notify(hasMediaStep ? t('concept.upload.added_reference') : t('concept.upload.set_as_media'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removeRef = async () => {
    setUploading(true);
    const r = await api.deleteReferenceImage(postId);
    setUploading(false);
    if (!r.ok) { notify(tError(r.error), 'err'); return; }
    setRefName(null);
    notify(t('concept.upload.removed'));
  };

  const disabled = busy || selecting || uploading;

  const reviewMode = !onContinue;
  return (
    <div className="gate-block concept-gate">
      <p className="muted small">
        {reviewMode ? t('concept.gate.review_hint') : t('concept.gate.pick_hint')}
      </p>

      <div className="variant-list">
        {variants.map((v, i) => (
          <button
            key={i}
            className={`variant-card${i === selected ? ' selected' : ''}`}
            disabled={disabled}
            onClick={() => void pick(i)}
          >
            <div className="variant-head">
              <span className="variant-radio">{i === selected ? '●' : '○'}</span>
              <span className="variant-title">{t('concept.version.label', { n: i + 1 })}</span>
            </div>
            <div className="variant-body">{v.body}</div>
          </button>
        ))}
      </div>

      {!reviewMode && (
        <div className="concept-ref">
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn small" disabled={disabled} onClick={() => inputRef.current?.click()}>
              {uploading ? t('concept.upload.busy') : refName ? t('concept.upload.replace_cta') : hasMediaStep ? t('concept.upload.reference_cta') : t('concept.upload.own_cta')}
            </button>
            {refName && <span className="muted small">{refName}</span>}
            {refName && <button className="btn small" disabled={disabled} onClick={() => void removeRef()}>{t('concept.upload.remove_cta')}</button>}
            <input ref={inputRef} type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={(e) => { if (e.target.files?.[0]) void upload(e.target.files[0]); }} />
          </div>
          <div className="help-text">
            {hasMediaStep ? t('concept.upload.help.media_step') : t('concept.upload.help.no_media_step')}
          </div>
        </div>
      )}

      {reviewMode ? (
        <p className="help-text">{t('concept.gate.active_version', { version: t('concept.version.label', { n: selected + 1 }) })}</p>
      ) : (
        <button className="btn primary" disabled={disabled} onClick={onContinue}>
          {busy ? t('concept.gate.continuing.busy') : t('concept.gate.continue_with.cta', { n: selected + 1 })}
        </button>
      )}
    </div>
  );
}
