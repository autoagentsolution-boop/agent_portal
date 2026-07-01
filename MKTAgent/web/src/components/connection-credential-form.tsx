// OAuth-less connect form for one platform. Shown when the platform isn't connected
// and the workspace wants to paste credentials directly (the /connect OAuth app isn't
// configured server-side). Write-only: inputs are password-type and cleared after save;
// values go encrypted into the vault via the publisher credential endpoint. On the
// required token save it reports success so the parent can flip the card to connected.
import { useState } from 'react';
import { api } from '../api/client';
import { publisherCredentialFields, type PublisherCredentialField } from '../flow/publisher-credential-fields';

interface Props {
  platformKey: string;
  displayName: string;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onSaved: () => void; // parent reloads connection state
}

export function ConnectionCredentialForm({ platformKey, displayName, notify, onSaved }: Props) {
  const fields: PublisherCredentialField[] = publisherCredentialFields[platformKey] ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (key: string, v: string) => setValues((cur) => ({ ...cur, [key]: v }));

  const save = async () => {
    const entries = fields
      .map((f) => ({ key: f.key, value: values[f.key]?.trim() ?? '' }))
      .filter((e) => e.value.length > 0);
    if (entries.length === 0) { notify('Enter at least the access token', 'err'); return; }

    setSaving(true);
    try {
      for (const e of entries) {
        const r = await api.savePublisherCredential(e.key, e.value);
        if (!r.ok) { notify(`Save ${e.key}: ${r.error.error}`, 'err'); return; }
      }
      setValues({});
      notify(`${displayName} credentials saved`);
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div className="conn-cred-form">
      {fields.map((f) => (
        <label className="conn-cred-field" key={f.key}>
          <span>{f.label}{f.required && <em className="req"> *</em>}</span>
          <input
            type="password"
            autoComplete="off"
            placeholder={f.required ? 'Required — paste value' : 'Optional'}
            value={values[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)}
          />
        </label>
      ))}
      <button className="btn primary small" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save & connect'}
      </button>
    </div>
  );
}
