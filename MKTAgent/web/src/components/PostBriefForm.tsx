import { useEffect, useState } from 'react';
import { api, type Dto, type PostDto } from '../api/client';
import { PlatformChecklist } from './PlatformChecklist';
import {
  assetTypeOptions,
  emptyToNull,
  fromLocalDateTimeInput,
  languageOptions,
  lengthOptions,
  toLocalDateTimeInput,
  type AssetType,
  type SocialPlatform,
} from './form-options';

type PostBody = Omit<Dto['CreatePostBody'], 'campaignId'>;

interface Props {
  campaignId: string;
  post?: PostDto | null;
  onSaved: (post: PostDto) => void;
  onCancel: () => void;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const initialState = (post?: PostDto | null): PostBody => ({
  assetType: post?.assetType ?? 'image',
  language: post?.language ?? '',
  lengthSpec: post?.lengthSpec ?? '',
  angle: post?.angle ?? '',
  brandVoice: post?.brandVoice ?? '',
  // driveFolderId / heroFile are no longer user-entered — storage is a Connection now, and
  // the media agents write heroFile themselves (local:<path>). Preserve any existing value
  // on an edit (so a manual re-save doesn't wipe generated media) but never expose an input.
  driveFolderId: post?.driveFolderId ?? '',
  heroFile: post?.heroFile ?? '',
  platforms: post?.platforms ?? ['facebook'],
  scheduledAt: toLocalDateTimeInput(post?.scheduledAt ?? null),
});

export function PostBriefForm({ campaignId, post, onSaved, onCancel, notify }: Props) {
  const [form, setForm] = useState<PostBody>(() => initialState(post));
  const [saving, setSaving] = useState(false);
  const mode = post ? 'edit' : 'create';

  useEffect(() => setForm(initialState(post)), [post]);

  const setField = <K extends keyof PostBody>(key: K, value: PostBody[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const payload = (): PostBody => ({
    assetType: form.assetType,
    language: emptyToNull(form.language ?? ''),
    lengthSpec: emptyToNull(form.lengthSpec ?? ''),
    angle: emptyToNull(form.angle ?? ''),
    brandVoice: emptyToNull(form.brandVoice ?? ''),
    driveFolderId: emptyToNull(form.driveFolderId ?? ''),
    heroFile: emptyToNull(form.heroFile ?? ''),
    platforms: form.platforms?.length ? form.platforms : [],
    scheduledAt: fromLocalDateTimeInput(String(form.scheduledAt ?? '')),
  });

  const save = async () => {
    setSaving(true);
    const body = payload();
    const result = post
      ? await api.updatePost(post.id, body)
      : await api.createPost({ campaignId, ...body });
    setSaving(false);
    if (result.ok) {
      notify(mode === 'edit' ? 'Brief updated' : 'Brief created');
      onSaved(result.data);
    } else {
      notify(`Brief save failed: ${result.error.error}`, 'err');
    }
  };

  const currentAsset = assetTypeOptions.find((o) => o.value === form.assetType);

  return (
    <div className="card setup-card">
      <div className="eyebrow">Write Concept Agent</div>
      <h3>{mode === 'edit' ? 'Edit post brief' : 'Create post brief'}</h3>
      <p className="muted small">Configure the exact concept before generation: language, length, media, platforms and schedule.</p>

      <div className="form-grid three">
        <div className="field">
          <label>Language</label>
          <select value={form.language ?? ''} onChange={(e) => setField('language', e.target.value)}>
            {languageOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Length</label>
          <select value={form.lengthSpec ?? ''} onChange={(e) => setField('lengthSpec', e.target.value)}>
            {lengthOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Asset type</label>
          <select value={form.assetType} onChange={(e) => setField('assetType', e.target.value as AssetType)}>
            {assetTypeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Media storage</label>
        <select value="local" disabled onChange={() => { /* only local for now */ }}>
          <option value="local">Local storage (active)</option>
          <option value="drive" disabled>Google Drive (coming soon)</option>
        </select>
        <div className="help-text">
          {currentAsset?.value === 'video' ? 'The video' : 'The image'} this flow generates is saved here automatically — no file IDs to enter.{' '}
          Manage storage in <strong>Connections</strong>.
        </div>
      </div>

      <div className="form-grid two">
        <div className="field">
          <label>Angle (override)</label>
          <input value={form.angle ?? ''} onChange={(e) => setField('angle', e.target.value)} placeholder="Per-post angle — blank inherits the campaign" />
        </div>
        <div className="field">
          <label>Brand voice (override)</label>
          <input value={form.brandVoice ?? ''} onChange={(e) => setField('brandVoice', e.target.value)} placeholder="Per-post voice — blank inherits the campaign" />
        </div>
      </div>

      <div className="field">
        <label>Target platforms</label>
        <PlatformChecklist value={(form.platforms ?? []) as SocialPlatform[]} onChange={(v) => setField('platforms', v)} />
      </div>

      <div className="field">
        <label>Schedule target</label>
        <input type="datetime-local" value={String(form.scheduledAt ?? '')} onChange={(e) => setField('scheduledAt', e.target.value)} />
        <div className="help-text">Approve can reuse this schedule. Empty means approve/publish as soon as possible.</div>
      </div>

      <div className="btn-row">
        <button className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save brief'}</button>
        <button className="btn" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
