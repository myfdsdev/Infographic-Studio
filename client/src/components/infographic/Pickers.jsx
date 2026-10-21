import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Palette } from 'lucide-react';
import { INFOGRAPHIC_STYLES, INFOGRAPHIC_RATIOS } from '../../utils/constants.js';

/**
 * A composer chip that opens a small menu above itself. `options` are
 * { value, label, description?, visual? }; `visual` is drawn before the label.
 */
function ChipSelect({ label, icon, valueLabel, value, options, onChange, disabled, menuLabel }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (next) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="iv-chip-select" ref={wrapRef}>
      <button
        type="button"
        className={`iv-chip ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${valueLabel}`}
      >
        {icon}
        <span className="iv-chip__text">
          <span className="iv-chip__label">{label}</span>
          <span className="iv-chip__value">{valueLabel}</span>
        </span>
        <ChevronDown size={14} className="iv-chip__caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="iv-chip-menu" role="listbox" aria-label={menuLabel || label}>
          <div className="iv-chip-menu__title">{menuLabel || label}</div>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                className={`iv-chip-menu__item ${active ? 'is-active' : ''}`}
                onClick={() => pick(option.value)}
              >
                {option.visual}
                <span className="iv-chip-menu__text">
                  <span className="iv-chip-menu__name">{option.label}</span>
                  {option.description && <span className="iv-chip-menu__desc">{option.description}</span>}
                </span>
                {active && <Check size={15} className="iv-chip-menu__check" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StyleSwatch({ style }) {
  return (
    <span className={`iv-swatch iv-swatch--${style}`} aria-hidden="true">
      <span />
      <span />
      <span />
      {style === 'colorful' && <span />}
    </span>
  );
}

function RatioShape({ ratio, size = 16 }) {
  const scale = size / Math.max(ratio.w, ratio.h);
  return (
    <span className="iv-ratio-shape" style={{ width: size, height: size }} aria-hidden="true">
      <span style={{ width: Math.round(ratio.w * scale), height: Math.round(ratio.h * scale) }} />
    </span>
  );
}

/** Minimal, Corporate or Colorful, as a composer chip. */
export function StyleSelect({ value, onChange, disabled, styles = INFOGRAPHIC_STYLES }) {
  const current = styles.find((s) => s.value === value) || styles[0];
  return (
    <ChipSelect
      label="Style"
      menuLabel="Visual style"
      icon={<Palette size={16} className="iv-chip__icon" aria-hidden="true" />}
      valueLabel={current.label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={styles.map((s) => ({ ...s, visual: <StyleSwatch style={s.value} /> }))}
    />
  );
}

/** 1:1, 3:4 or 9:16, as a composer chip. */
export function RatioSelect({ value, onChange, disabled, ratios = INFOGRAPHIC_RATIOS }) {
  const current = ratios.find((r) => r.value === value) || ratios[0];
  return (
    <ChipSelect
      label="Ratio"
      menuLabel="Aspect ratio"
      icon={<RatioShape ratio={current} />}
      valueLabel={current.value}
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={ratios.map((r) => ({ value: r.value, label: `${r.value}`, description: r.label, visual: <RatioShape ratio={r} size={22} /> }))}
    />
  );
}
