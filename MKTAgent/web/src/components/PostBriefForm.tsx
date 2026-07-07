import { useEffect, useState } from 'react';
import { api, type Dto, type PostDto, type ProductKnowledgeEntry } from '../api/client';
import { PlatformChecklist } from './PlatformChecklist';
import {
  assetTypeOptions,
  emptyToNull,
  fromLocalDateTimeInput,
  languageOptions,
  lengthOptions,
  platformAssetSupport,
  platformOptions,
  toLocalDateTimeInput,
  type AssetType,
  type SocialPlatform,
} from './form-options';

// Per-platform asset overrides (item 5). Keep only entries that DIFFER from the default
// asset type and are actually supported by that platform — everything else falls back to
// the default at publish time, so the map stays minimal.
type PlatformAssets = Partial<Record<SocialPlatform, AssetType>>;
const cleanPlatformAssets = (
  map: PlatformAssets,
  platforms: SocialPlatform[],
  fallback: AssetType,
): PlatformAssets => {
  const out: PlatformAssets = {};
  for (const p of platforms) {
    const v = map[p];
    if (v && v !== fallback && platformAssetSupport[p].includes(v)) out[p] = v;
  }
  return out;
};

type PostBody = Omit<Dto['CreatePostBody'], 'campaignId'>;

const REF_MAX_BYTES = 8 * 1024 * 1024;
const toB64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]*;base64,/, ''));
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });

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
  const [platformAssets, setPlatformAssets] = useState<PlatformAssets>(() => (post?.platformAssets as PlatformAssets) ?? {});
  const [knowledgeId, setKnowledgeId] = useState<string>(post?.productKnowledgeId ?? '');
  const [leadKeyword, setLeadKeyword] = useState<string>(post?.leadCaptureKeyword ?? '');
  const [versionCount, setVersionCount] = useState<number>(post?.versionCount ?? 1);
  const [library, setLibrary] = useState<ProductKnowledgeEntry[]>([]);
  // The language this post will actually generate in when the field is left blank (campaign lang →
  // user default). Shown as the input placeholder so "inherit" is never an opaque guess (feedback).
  const [resolvedLang, setResolvedLang] = useState<string>('');
  // Reference image to condition infographic/storyboard on (feedback): uploadable at brief time, not
  // only at the concept gate. Held until save, then POSTed to the (created) post's referenceImage.
  const [refFile, setRefFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const mode = post ? 'edit' : 'create';

  useEffect(() => {
    setForm(initialState(post));
    setPlatformAssets((post?.platformAssets as PlatformAssets) ?? {});
    setKnowledgeId(post?.productKnowledgeId ?? '');
    setLeadKeyword(post?.leadCaptureKeyword ?? '');
    setVersionCount(post?.versionCount ?? 1);
  }, [post]);

  // Product Knowledge library (item 6): the user picks a reusable entry to ground this post.
  useEffect(() => { void api.listProductKnowledge().then((r) => { if (r.ok) setLibrary(r.data); }); }, []);

  // Resolve the inherited language (campaign → user default) so the brief shows what a blank field
  // will actually produce (feedback: manual posts silently fell back to 'vi').
  useEffect(() => {
    void (async () => {
      const [c, m] = await Promise.all([api.getCampaign(campaignId), api.me()]);
      const camp = c.ok ? c.data.language : null;
      const usr = m.ok ? m.data?.defaultLanguage : null;
      setResolvedLang((camp || usr || 'vi').trim());
    })();
  }, [campaignId]);

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

  // Upload the chosen reference image onto a (now-existing) post. Best-effort: a failure warns but
  // never blocks the save. asHero=false → it's a REFERENCE the media agents follow, not the hero.
  const uploadRefIfAny = async (id: string): Promise<void> => {
    if (!refFile) return;
    if (refFile.size > REF_MAX_BYTES) { notify(`"${refFile.name}" is over 8MB — use a smaller image.`, 'err'); return; }
    try {
      const b64 = await toB64(refFile);
      const r = await api.uploadReferenceImage(id, b64, refFile.type || 'image/png', false);
      if (!r.ok) notify(`Reference image failed: ${r.error.error}`, 'err');
      else notify('Reference image added — infographic/storyboard will follow it');
    } catch { notify('Could not read the reference image', 'err'); }
  };

  const save = async () => {
    setSaving(true);
    const body = payload();
    const selected = (form.platforms ?? []) as SocialPlatform[];
    // Only overrides that differ from the default + are supported; null when empty so an
    // edit that clears all overrides resets the post back to the single default asset type.
    const overrides = cleanPlatformAssets(platformAssets, selected, form.assetType ?? 'image');
    const platformAssetsPayload = Object.keys(overrides).length ? overrides : null;
    const knowledgePayload = knowledgeId || null;
    const leadKeywordPayload = leadKeyword.trim() || null;
    if (post) {
      const result = await api.updatePost(post.id, { ...body, platformAssets: platformAssetsPayload, productKnowledgeId: knowledgePayload, leadCaptureKeyword: leadKeywordPayload, versionCount });
      if (result.ok) { await uploadRefIfAny(post.id); notify('Brief updated'); onSaved(result.data); }
      else notify(`Brief save failed: ${result.error.error}`, 'err');
      setSaving(false);
      return;
    }
    // Create then persist edit-only fields (platformAssets, library link, versionCount) with a
    // follow-up PATCH — CreatePostBody carries none of them.
    const created = await api.createPost({ campaignId, ...body });
    if (!created.ok) { setSaving(false); notify(`Brief save failed: ${created.error.error}`, 'err'); return; }
    let saved = created.data;
    if (platformAssetsPayload || knowledgePayload || leadKeywordPayload || versionCount !== 1) {
      const patched = await api.updatePost(saved.id, { platformAssets: platformAssetsPayload, productKnowledgeId: knowledgePayload, leadCaptureKeyword: leadKeywordPayload, versionCount });
      if (patched.ok) saved = patched.data;
    }
    await uploadRefIfAny(saved.id);
    setSaving(false);
    notify('Brief created');
    onSaved(saved);
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
          <input
            list="brief-language-list"
            value={form.language ?? ''}
            onChange={(e) => setField('language', e.target.value)}
            placeholder={resolvedLang ? `Inherit → ${resolvedLang}` : 'Inherit default'}
          />
          <datalist id="brief-language-list">
            {languageOptions.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </datalist>
          <div className="help-text">Type any language, or leave blank to inherit{resolvedLang ? ` (${resolvedLang})` : ''}.</div>
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

      {library.length > 0 && (
        <div className="field">
          <label>Product knowledge (library)</label>
          <select value={knowledgeId} onChange={(e) => setKnowledgeId(e.target.value)}>
            <option value="">Inherit from campaign</option>
            {library.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <div className="help-text">Ground this post in a reusable product profile. Analyze docs once at the Master Agent (or a campaign) to build the library.</div>
        </div>
      )}

      <div className="field">
        <label>Reference image (optional)</label>
        <input type="file" accept="image/*" onChange={(e) => setRefFile(e.target.files?.[0] ?? null)} />
        <div className="help-text">
          {refFile ? <><strong>{refFile.name}</strong> — </> : ''}
          Infographic/storyboard generate FROM this image (edit mode) so they follow your product/look.
          {post?.referenceImage && !refFile ? ' A reference image is already set; choosing a new one replaces it.' : ''}
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

      {(form.platforms ?? []).length > 0 && (
        <div className="field">
          <label>Asset per platform (optional)</label>
          <div className="help-text">Default is <strong>{currentAsset?.label ?? form.assetType}</strong> everywhere. Override where a platform should differ — only what it supports is offered (e.g. carousel/video are Facebook-only today).</div>
          <div className="platform-asset-grid">
            {((form.platforms ?? []) as SocialPlatform[]).map((p) => {
              const supported = platformAssetSupport[p];
              const label = platformOptions.find((o) => o.value === p)?.label ?? p;
              const value = platformAssets[p] ?? form.assetType ?? 'image';
              return (
                <div className="platform-asset-row" key={p}>
                  <span className="platform-asset-name">{label}</span>
                  <select
                    value={value}
                    onChange={(e) => setPlatformAssets((prev) => ({ ...prev, [p]: e.target.value as AssetType }))}
                  >
                    {assetTypeOptions
                      .filter((o) => supported.includes(o.value))
                      .map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="field">
        <label>Number of versions</label>
        <input
          type="number"
          min={1}
          max={5}
          value={versionCount}
          onChange={(e) => {
            const n = Number(e.target.value);
            setVersionCount(Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 1);
          }}
          style={{ maxWidth: 90 }}
        />
        <div className="help-text">How many copy versions to choose from (1 = a single version).</div>
      </div>

      <div className="field">
        <label>Lead capture keyword (optional)</label>
        <input value={leadKeyword} onChange={(e) => setLeadKeyword(e.target.value)} placeholder='e.g. "Atria AI" — a comment with this word + an email becomes an opt-in lead' />
        <div className="help-text">When set, comments on this post's published Facebook/Instagram containing the keyword <strong>and an email</strong> are captured as opt-in leads (e.g. commenter writes <em>"{leadKeyword || 'Atria AI'} me@email.com"</em>). Poll from the 🎯 Leads page.</div>
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
