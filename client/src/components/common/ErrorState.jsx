import { AlertTriangle } from 'lucide-react';
import Button from './Button.jsx';
import { errorMessage } from '../../services/api.js';

export default function ErrorState({ title = 'Something went wrong', error, onRetry, retryLabel = 'Try again', action, plain = false }) {
  const message = typeof error === 'string' ? error : errorMessage(error, '');
  return (
    <div className={`iv-state ${plain ? 'iv-state--plain' : ''}`.trim()} role="alert">
      <div className="iv-state__icon iv-state__icon--danger" aria-hidden="true">
        <AlertTriangle />
      </div>
      <h3 className="iv-state__title">{title}</h3>
      {message && <p className="iv-state__description">{message}</p>}
      {(onRetry || action) && (
        <div className="iv-state__action">
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
