import type { DemoMode } from '../flow/demo-flow';
import { useLocale } from '../i18n';

interface Props {
  mode: DemoMode;
  onChange: (mode: DemoMode) => void;
}

export function DemoModeToggle({ mode, onChange }: Props) {
  const { t } = useLocale();
  return (
    <div className="demo-toggle-simple segmented">
      <button className={mode === 'safe' ? 'active' : ''} onClick={() => onChange('safe')}>{t('demo.mode.safe')}</button>
      <button className={mode === 'live' ? 'active danger' : ''} onClick={() => onChange('live')}>{t('demo.mode.live')}</button>
    </div>
  );
}
