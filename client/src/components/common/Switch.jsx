import { useId } from 'react';

export default function Switch({ label, checked = false, onChange, disabled = false, id, hint }) {
  const autoId = useId();
  const switchId = id || `iv-switch-${autoId}`;
  return (
    <div className="iv-field">
      <label className="iv-switch" htmlFor={switchId}>
        <input
          id={switchId}
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(event) => onChange?.(event.target.checked)}
          disabled={disabled}
        />
        <span className="iv-switch__track" aria-hidden="true" />
        {label && <span className="iv-switch__label">{label}</span>}
      </label>
      {hint && <span className="iv-field__hint">{hint}</span>}
    </div>
  );
}
