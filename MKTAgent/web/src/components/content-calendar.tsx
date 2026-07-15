// Content calendar review/edit (Atria Phase 08 / surfaces Phases 03–05). The user reviews the
// strategist's proposed slots, edits pillar / angle / format / platforms / day, then "Approve &
// schedule" → materialize into scheduled posts (Phase 04) → a two-step grant with the UPFRONT cost
// estimate shown before autonomy is authorized (Phase 05). Nothing runs until the second confirm.
import { useState } from 'react';
import { api, type CalendarSlotDto, type CalendarFormat, type CampaignGrantResponse } from '../api/client';

interface Props {
  // The strategist run whose calendar this is. Approving creates the campaign from the run + materializes.
  runId: string;
  slots: CalendarSlotDto[]; // from the strategist's content_calendar artifact
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onDone?: (campaignId: string) => void; // e.g. switch to the campaign board
}

const FORMATS: CalendarFormat[] = ['text', 'image', 'carousel', 'video'];

export function ContentCalendar({ runId, slots: initial, notify, onDone }: Props) {
  const [slots, setSlots] = useState<CalendarSlotDto[]>(initial);
  const [phase, setPhase] = useState<'edit' | 'confirm' | 'done'>('edit');
  const [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState<CampaignGrantResponse | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);

  const patch = (i: number, p: Partial<CalendarSlotDto>) =>
    setSlots((s) => s.map((slot, idx) => (idx === i ? { ...slot, ...p } : slot)));
  const removeSlot = (i: number) => setSlots((s) => s.filter((_, idx) => idx !== i).map((slot, idx) => ({ ...slot, index: idx })));

  // Step 1: create the campaign from the run + materialize, then request the grant token
  // (which returns the whole-calendar cost estimate before anything is authorized to run).
  const approve = async () => {
    setBusy(true);
    const mat = await api.materializeCalendarFromRun(runId, slots);
    if (!mat.ok) { setBusy(false); return notify(mat.error.error, 'err'); }
    const cid = mat.data.campaignId;
    setCampaignId(cid);
    const g = await api.grantCampaign(cid, {}); // step 1 → pendingConfirmation + estimate
    setBusy(false);
    if (!g.ok) return notify(g.error.error, 'err');
    setGrant(g.data);
    setPhase('confirm');
  };

  // Step 2: confirm autonomy with the token + schedule confirmation.
  const confirmGrant = async () => {
    if (!grant?.confirmationToken || !campaignId) return;
    setBusy(true);
    const g = await api.grantCampaign(campaignId, { confirmationToken: grant.confirmationToken, scheduleConfirmed: true });
    setBusy(false);
    if (!g.ok) return notify(g.error.error, 'err');
    notify(`Granted — ${g.data.granted ?? 0} posts will run autonomously.`);
    setPhase('done');
    onDone?.(campaignId);
  };

  if (phase === 'done') return <p className="ok">Campaign approved — watch it on the board.</p>;

  if (phase === 'confirm' && grant) {
    const e = grant.estimate;
    return (
      <section style={{ maxWidth: 560 }}>
        <h3>Confirm autonomy</h3>
        <p>You're about to let Atria run <strong>{e.posts} posts</strong> automatically.</p>
        <p style={{ fontSize: 16 }}>Estimated cost: <strong>${e.costUsd.toFixed(2)}</strong> (≈ {e.credits} credits)</p>
        <p className="muted">Each post is still guardrailed at publish time — a bad one holds for you instead of blocking the rest.</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn-primary" disabled={busy} onClick={() => void confirmGrant()}>Confirm & run</button>
          <button onClick={() => setPhase('edit')} disabled={busy}>Back</button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h3>Content calendar <span className="muted">({slots.length} posts)</span></h3>
      <p className="muted">Edit anything before scheduling. Approving creates the posts and asks you to confirm once more.</p>
      <div className="calendar-slot-list">
        {slots.map((s, i) => (
          <div key={i} className="calendar-slot-row">
            <span className="muted slot-index">#{i + 1}</span>
            <input className="slot-pillar" value={s.pillar} onChange={(e) => patch(i, { pillar: e.target.value })} placeholder="pillar" />
            <input className="slot-angle" value={s.angle} onChange={(e) => patch(i, { angle: e.target.value })} placeholder="angle" />
            <select className="slot-format" value={s.format} onChange={(e) => patch(i, { format: e.target.value as CalendarFormat })}>
              {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <input className="slot-platforms" value={s.platforms.join(',')} onChange={(e) => patch(i, { platforms: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="platforms" title="comma-separated" />
            <input className="slot-day" type="number" min={0} value={s.dayOffset} onChange={(e) => patch(i, { dayOffset: Math.max(0, Number(e.target.value) || 0) })} title="day offset" />
            <button className="icon-btn slot-remove" aria-label="Remove slot" onClick={() => removeSlot(i)}>×</button>
          </div>
        ))}
      </div>
      <button className="btn-primary" disabled={busy || slots.length === 0} onClick={() => void approve()}>
        {busy ? 'Scheduling…' : 'Approve & schedule'}
      </button>
    </section>
  );
}
