import type { DemoMode } from '../flow/demo-flow';

interface Props {
  mode: DemoMode;
  onChange: (mode: DemoMode) => void;
}

export function DemoModeToggle({ mode, onChange }: Props) {
  return (
    <div className="demo-toggle-simple segmented">
      <button className={mode === 'safe' ? 'active' : ''} onClick={() => onChange('safe')}>Safe</button>
      <button className={mode === 'live' ? 'active danger' : ''} onClick={() => onChange('live')}>Live</button>
    </div>
  );
}
