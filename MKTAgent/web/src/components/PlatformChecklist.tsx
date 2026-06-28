import { platformOptions, type SocialPlatform } from './form-options';

interface Props {
  value: SocialPlatform[];
  onChange: (value: SocialPlatform[]) => void;
}

export function PlatformChecklist({ value, onChange }: Props) {
  const selected = new Set(value);
  const toggle = (platform: SocialPlatform) => {
    const next = selected.has(platform)
      ? value.filter((p) => p !== platform)
      : [...value, platform];
    onChange(next);
  };

  return (
    <div className="platform-grid">
      {platformOptions.map((option) => (
        <label className="check-pill" key={option.value}>
          <input
            type="checkbox"
            checked={selected.has(option.value)}
            onChange={() => toggle(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
