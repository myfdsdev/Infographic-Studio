import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  children,
  closeOnBackdrop = true,
  hideClose = false,
}) {
  const titleId = useId();
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    document.body.classList.add('iv-no-scroll');

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);

    const focusTimer = setTimeout(() => {
      const target = dialogRef.current?.querySelector('[data-autofocus], input, select, textarea, button');
      target?.focus();
    }, 20);

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('iv-no-scroll');
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="iv-modal" role="presentation">
      <div className="iv-modal__backdrop" onClick={closeOnBackdrop ? onClose : undefined} />
      <div
        ref={dialogRef}
        className={`iv-modal__dialog iv-modal__dialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
      >
        {(title || !hideClose) && (
          <div className="iv-modal__head">
            <div>
              {title && (
                <h2 className="iv-modal__title" id={titleId}>
                  {title}
                </h2>
              )}
              {description && <p className="iv-card__subtitle">{description}</p>}
            </div>
            {!hideClose && (
              <button type="button" className="iv-modal__close" aria-label="Close dialog" onClick={onClose}>
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className="iv-modal__body">{children}</div>
        {footer && <div className="iv-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}
