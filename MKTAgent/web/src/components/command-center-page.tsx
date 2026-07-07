// Atria Command Center — the "Neural Network" landing (Atria Phase 04). A visual,
// page-scoped dark surface that renders REAL registry nodes (GET /orchestration/agents)
// grouped by division, with the live credit total (GET /orchestration/usage). It is a
// funnel, not a second app: every node / the core / the command bar redirects into the
// existing Orchestrate surface (onLaunch), and ⌂ Workspace exits back to the normal UI
// (onExit). Dark theme is confined to `.command-center` so the rest of the app is
// untouched — the safe, incremental adoption the plan calls for.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type AgentCatalog, type AgentNodeDto } from '../api/client';

interface Props {
  // Redirect into the live Orchestrate surface, optionally seeding the composer.
  onLaunch: (prefill?: string) => void;
  // Leave the command center for the normal workspace (current UI/UX).
  onExit: () => void;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const QUICK_CMDS = [
  'Tạo chiến dịch marketing cho sản phẩm mới',
  'Nghiên cứu đối thủ rồi viết nội dung',
  'Thu thập leads từ chiến dịch social (opt-in)',
];

// Position N nodes evenly on an ellipse, starting at the top (−90°). Mirrors the mockup's
// buildNetwork layout so the visual reads the same, but driven by real registry data.
const nodePos = (i: number, total: number): { left: string; top: string } => {
  const ang = (i / total) * Math.PI * 2 - Math.PI / 2;
  return { left: `${50 + Math.cos(ang) * 42}%`, top: `${50 + Math.sin(ang) * 40}%` };
};

export function CommandCenterPage({ onLaunch, onExit, notify }: Props) {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [cmd, setCmd] = useState('');

  useEffect(() => {
    void api.getAgents().then((r) => {
      if (r.ok) setCatalog(r.data);
      else notify(`Agents: ${r.error.error}`, 'err');
    });
    void api.getUsage().then((r) => { if (r.ok) setCredits(r.data.credits); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const colorOf = useMemo(() => {
    const map = new Map((catalog?.groups ?? []).map((g) => [g.id, g.color]));
    return (a: AgentNodeDto) => map.get(a.group) ?? '#9d7bff';
  }, [catalog]);

  const agents = catalog?.agents ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onLaunch(cmd.trim() || undefined);
  };

  return (
    <div className="command-center">
      <div className="cc-topbar">
        <span className="cc-logo" />
        <span className="cc-brand">Atria</span>
        <span className="cc-tag">Command Center</span>
        <div className="cc-topbar-right">
          <span className="cc-credit" title="Tổng credit đã dùng (minh bạch token → credit)">
            ◈ {credits === null ? '—' : credits.toLocaleString()} credits
          </span>
          <button className="cc-exit" onClick={onExit}>⌂ Workspace</button>
        </div>
      </div>

      <div className="cc-head">
        <div className="cc-eyebrow">Neural Network</div>
        <h1>Trung tâm điều hành AI của bạn</h1>
        <p>Chạm vào một agent để bắt đầu điều phối. Mọi hành động đều dẫn về không gian làm việc hiện tại.</p>
        <div className="cc-legend">
          {(catalog?.groups ?? []).map((g) => (
            <span className="cc-legend-item" key={g.id}>
              <span className="cc-legend-dot" style={{ background: g.color, boxShadow: `0 0 8px ${g.color}` }} />
              {g.emoji} {g.label}
            </span>
          ))}
        </div>
      </div>

      <div className="cc-network">
        <button className="cc-core" onClick={() => onLaunch()}>
          <span className="cc-core-label">Master Agent</span>
          <span className="cc-core-name">Atria</span>
          <span className="cc-core-sub">Nhạc trưởng</span>
        </button>
        <svg className="cc-links" viewBox="0 0 100 100" preserveAspectRatio="none">
          {agents.map((a, i) => {
            const ang = (i / agents.length) * Math.PI * 2 - Math.PI / 2;
            return (
              <line
                key={a.id}
                x1={50} y1={50}
                x2={50 + Math.cos(ang) * 42} y2={50 + Math.sin(ang) * 40}
                stroke={colorOf(a)} strokeOpacity={0.22} strokeWidth={0.3} strokeDasharray="1 1.3"
              />
            );
          })}
        </svg>
        {agents.map((a, i) => {
          const planned = a.implStatus === 'planned';
          return (
            <button
              key={a.id}
              className={`cc-node ${a.implStatus === 'stub' ? 'is-stub' : ''} ${planned ? 'is-planned' : ''}`}
              style={nodePos(i, agents.length)}
              onClick={() => planned ? notify(`${a.name} — sắp ra mắt`) : onLaunch()}
              title={planned ? `${a.name} (sắp ra mắt) — ${a.vibe ?? a.description}` : (a.vibe ?? a.description)}
            >
              <span className="cc-node-circle" style={{ borderColor: colorOf(a) }}>
                <span className="cc-node-emoji">{a.emoji}</span>
                {planned && <span className="cc-node-soon">soon</span>}
              </span>
              <span className="cc-node-label">{a.name.replace(/ Agent$/, '')}</span>
            </button>
          );
        })}
        {agents.length === 0 && <div className="cc-network-empty">Đang tải mạng lưới agent…</div>}
      </div>

      <form className="cc-cmdbar-wrap" onSubmit={submit}>
        <div className="cc-cmdbar">
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder="Ra lệnh cho Atria bằng ngôn ngữ tự nhiên…"
          />
          <button type="submit" className="cc-send" aria-label="Gửi">➤</button>
        </div>
        <div className="cc-quick">
          {QUICK_CMDS.map((q) => (
            <button type="button" className="cc-quick-cmd" key={q} onClick={() => setCmd(q)}>{q}</button>
          ))}
        </div>
        <div className="cc-hint">Atria tự nhận diện ngôn ngữ, xác nhận cách hiểu, rồi đề xuất phương án kèm chi phí.</div>
      </form>
    </div>
  );
}
