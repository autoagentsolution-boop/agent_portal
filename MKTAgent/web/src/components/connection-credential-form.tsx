// Paste-a-token form for one platform (the ADVANCED fallback to one-click OAuth Connect).
// Write-only: inputs are password-type and cleared after save; values go encrypted into the
// vault via the publisher credential endpoint. Required fields (token + identity id) show
// first; app/client creds hide under an "Advanced" disclosure so non-tech users aren't
// overwhelmed. On save it reports success so the parent flips the card to connected.
import { useState } from 'react';
import { api } from '../api/client';
import { publisherCredentialFields, type PublisherCredentialField } from '../flow/publisher-credential-fields';
import { useLocale } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props {
  platformKey: string;
  displayName: string;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onSaved: () => void; // parent reloads connection state
}

export function ConnectionCredentialForm({ platformKey, displayName, notify, onSaved }: Props) {
  const { t } = useLocale();
  const config = publisherCredentialFields[platformKey] ?? { required: [], advanced: [] };
  const [values, setValues] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (key: string, v: string) => setValues((cur) => ({ ...cur, [key]: v }));

  const save = async () => {
    const all = [...config.required, ...config.advanced];
    const entries = all
      .map((f) => ({ key: f.key, value: values[f.key]?.trim() ?? '' }))
      .filter((e) => e.value.length > 0);
    if (entries.length === 0) { notify(t('connections.cred.token_required'), 'err'); return; }

    setSaving(true);
    try {
      // Save the identity/app fields first, then the access token last so its liveness
      // verify (server-side) sees the ids already stored.
      const ordered = [...entries].sort((a) => (a.key.endsWith('_access_token') ? 1 : -1));
      let verify: { alive: boolean; reason?: string } | undefined;
      for (const e of ordered) {
        const r = await api.savePublisherCredential(e.key, e.value);
        if (!r.ok) { notify(t('connections.cred.err.save', { field: e.key, error: tError(r.error) }), 'err'); return; }
        if (e.key.endsWith('_access_token')) verify = r.data.verify;
      }
      setValues({});
      if (verify && !verify.alive) {
        notify(t('connections.cred.saved_unverified', { platform: displayName, reason: verify.reason ?? t('connections.cred.liveness_failed') }), 'err');
      } else if (verify?.alive) {
        notify(t('connections.cred.connected', { platform: displayName }));
      } else {
        notify(t('connections.cred.saved', { platform: displayName }));
      }
      onSaved();
    } finally { setSaving(false); }
  };

  const renderField = (f: PublisherCredentialField) => (
    <label className="conn-cred-field" key={f.key}>
      <span>{f.label}</span>
      <input
        type="password"
        autoComplete="off"
        placeholder={t('connections.cred.paste_placeholder')}
        value={values[f.key] ?? ''}
        onChange={(e) => set(f.key, e.target.value)}
      />
      {f.hint && <small className="muted">{f.hint}</small>}
    </label>
  );

  return (
    <div className="conn-cred-form">
      {config.required.map(renderField)}

      {config.advanced.length > 0 && (
        <>
          <button type="button" className="conn-advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? t('connections.cred.advanced_open') : t('connections.cred.advanced_closed')}
          </button>
          {showAdvanced && config.advanced.map(renderField)}
        </>
      )}

      <button className="btn primary small" disabled={saving} onClick={() => void save()}>
        {saving ? t('connections.cred.saving') : t('connections.cred.save_connect_cta')}
      </button>
    </div>
  );
}
