import { forwardRef, useId } from 'react';

const Input = forwardRef(function Input(
  {
    label,
    labelHint,
    hint,
    error,
    icon: Icon,
    right,
    textarea = false,
    rows = 3,
    mono = false,
    className = '',
    id,
    required,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id || `iv-input-${autoId}`;
  const describedBy = [];
  if (hint) describedBy.push(`${inputId}-hint`);
  if (error) describedBy.push(`${inputId}-error`);

  const classes = ['iv-input'];
  if (textarea) classes.push('iv-input--textarea');
  if (Icon) classes.push('iv-input--icon');
  if (right) classes.push('iv-input--right');
  if (mono) classes.push('iv-input--mono');
  if (error) classes.push('is-invalid');
  if (className) classes.push(className);

  const Control = textarea ? 'textarea' : 'input';

  return (
    <div className="iv-field">
      {label && (
        <label className="iv-field__label" htmlFor={inputId}>
          {label}
          {required && <span aria-hidden="true"> *</span>}
          {labelHint && <span className="iv-field__label-hint"> {labelHint}</span>}
        </label>
      )}
      <div className="iv-field__control">
        {Icon && (
          <span className="iv-field__icon" aria-hidden="true">
            <Icon />
          </span>
        )}
        <Control
          ref={ref}
          id={inputId}
          className={classes.join(' ')}
          rows={textarea ? rows : undefined}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy.length ? describedBy.join(' ') : undefined}
          required={required}
          {...rest}
        />
        {right && <span className="iv-field__right">{right}</span>}
      </div>
      {hint && !error && (
        <span className="iv-field__hint" id={`${inputId}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="iv-field__error" id={`${inputId}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
});

export default Input;
