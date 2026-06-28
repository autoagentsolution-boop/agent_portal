import { useEffect, useState } from 'react';
import { api, type CampaignDto, type Dto } from '../api/client';
import { PlatformChecklist } from './PlatformChecklist';
import { emptyToNull, languageOptions, lengthOptions, type SocialPlatform } from './form-options';

type CampaignBody = Dto['CreateCampaignBody'];

interface Props {
  campaign?: CampaignDto | null;
  mode: 'create' | 'edit';
  onSaved: (campaign: CampaignDto) => void;
  onCancel: () => void;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const initialState = (campaign?: CampaignDto | null): CampaignBody => ({
  product: campaign?.product ?? '',
  angle: campaign?.angle ?? '',
  brandContext: campaign?.brandContext ?? '',
  leadsForm: campaign?.leadsForm ?? '',
  active: campaign?.active ?? true,
  language: campaign?.language ?? '',
  defaultLength: campaign?.defaultLength ?? '',
  platforms: campaign?.platforms ?? ['facebook'],
  brandVoice: campaign?.brandVoice ?? '',
  postingWindow: campaign?.postingWindow ?? '',
  timezone: campaign?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
});

export function CampaignSetupForm({ campaign, mode, onSaved, onCancel, notify }: Props) {
  const [form, setForm] = useState<CampaignBody>(() => initialState(campaign));
  const [saving, setSaving] = useState(false);

  useEffect(() => setForm(initialState(campaign)), [campaign]);

  const setField = <K extends keyof CampaignBody>(key: K, value: CampaignBody[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const payload = (): CampaignBody => ({
    product: form.product.trim(),
    angle: emptyToNull(form.angle ?? ''),
    brandContext: emptyToNull(form.brandContext ?? ''),
    leadsForm: emptyToNull(form.leadsForm ?? ''),
    active: form.active,
    language: emptyToNull(form.language ?? ''),
    defaultLength: emptyToNull(form.defaultLength ?? ''),
    platforms: form.platforms?.length ? form.platforms : [],
    brandVoice: emptyToNull(form.brandVoice ?? ''),
    postingWindow: emptyToNull(form.postingWindow ?? ''),
    timezone: emptyToNull(form.timezone ?? ''),
  });

  const save = async () => {
    if (!form.product.trim()) { notify('Product / offer is required', 'err'); return; }
    setSaving(true);
    const body = payload();
    const result = mode === 'edit' && campaign
      ? await api.updateCampaign(campaign.id, body)
      : await api.createCampaign(body);
    setSaving(false);
    if (result.ok) {
      notify(mode === 'edit' ? 'Campaign updated' : 'Campaign created');
      onSaved(result.data);
    } else {
      notify(`Campaign save failed: ${result.error.error}`, 'err');
    }
  };

  return (
    <div className="card setup-card">
      <div className="eyebrow">Master Agent Intake</div>
      <h3>{mode === 'edit' ? 'Polish campaign setup' : 'Create campaign brief'}</h3>
      <p className="muted small">These inputs drive copy-gen: language, tone, angle, length, CTA and target channels.</p>

      <div className="form-grid two">
        <div className="field">
          <label>Product / offer *</label>
          <input value={form.product} onChange={(e) => setField('product', e.target.value)} placeholder="AI Agent Course" />
        </div>
        <div className="field">
          <label>Language</label>
          <select value={form.language ?? ''} onChange={(e) => setField('language', e.target.value)}>
            {languageOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Angle / product brief</label>
        <textarea value={form.angle ?? ''} onChange={(e) => setField('angle', e.target.value)} placeholder="What should the post emphasize? Pain, proof, offer, audience, key story…" />
      </div>

      <div className="form-grid two">
        <div className="field">
          <label>Tone / brand voice</label>
          <textarea value={form.brandVoice ?? ''} onChange={(e) => setField('brandVoice', e.target.value)} placeholder="Direct, expert, friendly, Vietnamese founder voice…" />
        </div>
        <div className="field">
          <label>Brand context / proof</label>
          <textarea value={form.brandContext ?? ''} onChange={(e) => setField('brandContext', e.target.value)} placeholder="Facts the model can use. Avoid unsupported claims." />
        </div>
      </div>

      <div className="form-grid two">
        <div className="field">
          <label>Default post length</label>
          <select value={form.defaultLength ?? ''} onChange={(e) => setField('defaultLength', e.target.value)}>
            {lengthOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Lead form CTA URL</label>
          <input value={form.leadsForm ?? ''} onChange={(e) => setField('leadsForm', e.target.value)} placeholder="https://..." />
        </div>
      </div>

      <div className="field">
        <label>Target platforms</label>
        <PlatformChecklist value={(form.platforms ?? []) as SocialPlatform[]} onChange={(v) => setField('platforms', v)} />
      </div>

      <div className="form-grid two">
        <div className="field">
          <label>Posting window</label>
          <input value={form.postingWindow ?? ''} onChange={(e) => setField('postingWindow', e.target.value)} placeholder="09:00-11:00" />
        </div>
        <div className="field">
          <label>Timezone</label>
          <input value={form.timezone ?? ''} onChange={(e) => setField('timezone', e.target.value)} placeholder="Asia/Bangkok" />
        </div>
      </div>

      <div className="btn-row">
        <button className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save setup'}</button>
        <button className="btn" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
