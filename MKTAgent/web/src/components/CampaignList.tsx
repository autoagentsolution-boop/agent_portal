import { useEffect, useState } from 'react';
import { api, type CampaignDto } from '../api/client';
import { CampaignSetupForm } from './CampaignSetupForm';

interface Props {
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onChange: () => void;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

export function CampaignList({ activeId, onSelect, onChange, notify }: Props) {
  const [campaigns, setCampaigns] = useState<CampaignDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CampaignDto | null>(null);

  const load = async () => {
    setLoading(true);
    const r = await api.listCampaigns();
    if (r.ok) setCampaigns(r.data);
    else notify(`Load failed: ${r.error.error}`, 'err');
    setLoading(false);
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = async (campaign: CampaignDto) => {
    setCreating(false);
    setEditing(null);
    await load();
    onSelect(campaign.id);
    onChange();
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete “${name}” and all its posts?`)) return;
    const r = await api.deleteCampaign(id);
    if (r.ok) {
      notify('Campaign deleted');
      if (activeId === id) onSelect(null);
      await load();
      onChange();
    } else notify(`Delete failed: ${r.error.error}`, 'err');
  };

  return (
    <div>
      <div className="spread" style={{ marginBottom: 12 }}>
        <div>
          <strong>Campaigns</strong>
          <div className="muted small">Full brief: language, tone, length, CTA and channels.</div>
        </div>
        <button className="btn" onClick={() => { setCreating((v) => !v); setEditing(null); }}>{creating ? '×' : '+ New'}</button>
      </div>

      {creating && (
        <CampaignSetupForm
          mode="create"
          onSaved={(c) => void saved(c)}
          onCancel={() => setCreating(false)}
          notify={notify}
        />
      )}

      {editing && (
        <CampaignSetupForm
          mode="edit"
          campaign={editing}
          onSaved={(c) => void saved(c)}
          onCancel={() => setEditing(null)}
          notify={notify}
        />
      )}

      <div
        className={`camp-item ${activeId === null ? 'active' : ''}`}
        onClick={() => onSelect(null)}
      >
        <div className="product">All posts</div>
        <div className="meta">across every campaign</div>
      </div>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : (
        campaigns.map((c) => (
          <div
            key={c.id}
            className={`camp-item ${activeId === c.id ? 'active' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            <div className="spread">
              <div className="product">{c.product}</div>
              <div className="row">
                <button
                  className="btn" style={{ padding: '2px 8px' }}
                  onClick={(e) => { e.stopPropagation(); setCreating(false); setEditing(c); }}
                >Edit</button>
                <button
                  className="btn danger" style={{ padding: '2px 8px' }}
                  onClick={(e) => { e.stopPropagation(); void remove(c.id, c.product); }}
                >✕</button>
              </div>
            </div>
            <div className="meta">
              {c.language ?? 'inherit language'} · {c.defaultLength ?? 'inherit length'} · {c.platforms.length ? c.platforms.join(', ') : 'no platforms'}
              {c.angle ? ' · angle set' : ' · needs angle'}
              {c.brandVoice ? ' · tone set' : ' · needs tone'}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
