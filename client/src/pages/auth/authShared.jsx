import { AlertCircle, Eye, CheckCircle2 } from 'lucide-react';
import Button from '../../components/common/Button.jsx';
import { isNotImplemented, errorMessage } from '../../services/api.js';

/** Inline alert used by every auth form. */
export function AuthAlert({ error, tone = 'danger', children }) {
  if (!error && !children) return null;
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div className={`iv-alert iv-alert--${tone} mb-3`} role="alert">
      <Icon aria-hidden="true" />
      <span>{children || errorMessage(error)}</span>
    </div>
  );
}

/**
 * When the auth endpoints are not implemented yet, say so and offer the
 * explicit preview switch instead of pretending the request succeeded.
 */
export function PendingAuthNotice({ error, onPreview, action = 'Sign-in' }) {
  if (!isNotImplemented(error)) return null;
  return (
    <div className="iv-alert iv-alert--warning mb-3" role="status">
      <AlertCircle aria-hidden="true" />
      <div>
        <div>
          <strong>{action} backend not connected yet.</strong> The authentication API ships in a later phase.
        </div>
        {onPreview && (
          <div className="mt-2">
            <Button size="sm" variant="secondary" icon={Eye} onClick={onPreview}>
              Browse UI in preview mode
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
