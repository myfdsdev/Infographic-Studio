import { PlugZap } from 'lucide-react';

/**
 * The honest state for a screen whose backend endpoint has not shipped yet.
 * Shown instead of fake data whenever the API answers "route not found".
 */
export default function IntegrationPending({
  title = 'Backend not connected yet',
  endpoint,
  description,
  compact = false,
  action,
}) {
  return (
    <div className={`iv-integration ${compact ? 'iv-integration--compact' : ''}`} role="status">
      <span className="iv-integration__icon" aria-hidden="true">
        <PlugZap />
      </span>
      <div className="min-w-0 flex-grow-1">
        <p className="iv-integration__title">{title}</p>
        <p className="iv-integration__text">
          {description || 'This screen is wired to the API but the endpoint is implemented in a later phase.'}
          {endpoint && (
            <>
              {' '}
              It will load from <code>{endpoint}</code>.
            </>
          )}
        </p>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
