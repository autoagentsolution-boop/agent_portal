import type { DemoMode } from '../flow/demo-flow';
import { demoModeCopy } from '../flow/demo-flow';

interface Props {
  mode: DemoMode;
  onChange: (mode: DemoMode) => void;
}

export function DemoModeToggle({ mode, onChange }: Props) {
  return (
    <div className="demo-toggle card compact">
      <div className="spread">
        <div>
          <div className="eyebrow">Demo mode</div>
          <strong>{demoModeCopy[mode].title}</strong>
        </div>
        <div className="segmented">
          <button className={mode === 'safe' ? 'active' : ''} onClick={() => onChange('safe')}>Safe</button>
          <button className={mode === 'live' ? 'active danger' : ''} onClick={() => onChange('live')}>Live</button>
        </div>
      </div>
      <p className="muted small">{demoModeCopy[mode].detail}</p>
    </div>
  );
}
