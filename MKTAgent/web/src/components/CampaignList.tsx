import { useEffect, useState } from 'react';
import { api, type CampaignDto } from '../api/client';

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
  const [product, setProduct] = useState('');

  const load = async () => {
    setLoading(true);
    const r = await api.listCampaigns();
    if (r.ok) setCampaigns(r.data);
    else notify(`Load failed: ${r.error.error}`, 'err');
    setLoading(false);
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (!product.trim()) return;
    const r = await api.createCampaign({ product: product.trim() });
    if (r.ok) {
      notify(`Created “${r.data.product}”`);
      setProduct('');
      setCreating(false);
      await load();
      onSelect(r.data.id);
      onChange();
    } else notify(`Create failed: ${r.error.error}`, 'err');
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
        <strong>Campaigns</strong>
        <button className="btn" onClick={() => setCreating((v) => !v)}>{creating ? '×' : '+ New'}</button>
      </div>

      {creating && (
        <div className="card">
          <div className="field">
            <label>Product / offer</label>
            <input
              autoFocus value={product} onChange={(e) => setProduct(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
              placeholder="e.g. AI Agent Course"
            />
          </div>
          <button className="btn primary" onClick={() => void create()}>Create</button>
        </div>
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
              <button
                className="btn danger" style={{ padding: '2px 8px' }}
                onClick={(e) => { e.stopPropagation(); void remove(c.id, c.product); }}
              >✕</button>
            </div>
            <div className="meta">
              {c.language ?? 'lang: inherit'} · {c.platforms.length ? c.platforms.join(', ') : 'no platforms'}
              {c.active ? '' : ' · inactive'}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
