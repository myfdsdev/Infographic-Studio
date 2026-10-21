import { forwardRef, useId } from 'react';

const Select = forwardRef(function Select(
  { label, labelHint, hint, error, options = [], placeholder, className = '', id, required, ...rest },
  ref,
) {
  const autoId = useId();
  const selectId = id || `iv-select-${autoId}`;
  const classes = ['iv-select'];
  if (error) classes.push('is-invalid');
  if (className) classes.push(className);

  return (
    <div className="iv-field">
      {label && (
        <label className="iv-field__label" htmlFor={selectId}>
          {label}
          {required && <span aria-hidden="true"> *</span>}
          {labelHint && <span className="iv-field__label-hint"> {labelHint}</span>}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        className={classes.join(' ')}
        aria-invalid={error ? 'true' : undefined}
        required={required}
        {...rest}
      >
        {placeholder !== undefined && (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && !error && <span className="iv-field__hint">{hint}</span>}
      {error && (
        <span className="iv-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
});

export default Select;
