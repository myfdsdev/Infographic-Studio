import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import Button from '../common/Button.jsx';

/** Full-screen preview of a finished infographic. Esc or the close button exits. */
export default function Lightbox({ open, src, title, downloadHref, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('iv-no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('iv-no-scroll');
    };
  }, [open, onClose]);

  if (!open || !src) return null;

  return createPortal(
    <div className="iv-lightbox" role="dialog" aria-modal="true" aria-label={title || 'Infographic preview'}>
      <div className="iv-lightbox__bar">
        <strong>{title}</strong>
        {downloadHref && (
          <Button variant="secondary" size="sm" icon={Download} href={downloadHref} target="_self" download>
            Download
          </Button>
        )}
        <Button variant="ghost" size="sm" iconOnly icon={X} onClick={onClose} aria-label="Close preview" data-autofocus />
      </div>
      <div className="iv-lightbox__stage" onClick={(event) => event.target === event.currentTarget && onClose?.()}>
        <img src={src} alt={title || 'Infographic'} />
      </div>
    </div>,
    document.body,
  );
}
