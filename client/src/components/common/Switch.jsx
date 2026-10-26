import { useId } from 'react';

// `ariaLabel` names the switch for screen readers when the visible label is
// only its state (for example "On" / "Off" in a table row).
export default function Switch({ label, ariaLabel, checked = false, onChange, disabled = false, id, hint }) {
  const autoId = useId();
  const switchId = id || `iv-switch-${autoId}`;
  const hintId = hint ? `${switchId}-hint` : undefined;
  const name = ariaLabel || (typeof label === 'string' ? label : undefined);
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
          aria-label={name}
          aria-describedby={hintId}
        />
        <span className="iv-switch__track" aria-hidden="true" />
        {label && <span className="iv-switch__label">{label}</span>}
      </label>
      {hint && (
        <span id={hintId} className="iv-field__hint">
          {hint}
        </span>
      )}
    </div>
  );
}
