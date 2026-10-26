import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Eye, RefreshCw, LogIn } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import Loader from '../components/common/Loader.jsx';
import AuthLayout from '../components/layout/AuthLayout.jsx';
import Button from '../components/common/Button.jsx';
import { ROUTES } from '../utils/constants.js';
import { useBranding } from '../hooks/useBranding.js';

/**
 * Shown when the session cannot be checked: the API is unreachable, its
 * database is down, the API is rate limiting this address, or (only before
 * the auth backend existed) the auth endpoints are missing. Nothing is faked.
 */
function AuthUnavailable({ status, error, onRetry, onPreview }) {
  const { appName } = useBranding();
  const databaseDown = error?.code === 'DATABASE_UNAVAILABLE';
  const rateLimited = error?.code === 'RATE_LIMITED';
  const unreachable = status === 'error' && !databaseDown && !rateLimited;
  const title = databaseDown
    ? 'Database not connected'
    : rateLimited
      ? 'Too many requests'
      : unreachable
        ? 'API not reachable'
        : 'Sign-in not connected yet';
  const subtitle = databaseDown
    ? 'The API is running but cannot reach MongoDB. Check MONGODB_URI in server/.env or start a local database with "npm run db:dev", then retry.'
    : rateLimited
      ? `${appName} received a lot of requests from your connection in a short time. Wait a minute, then retry.`
      : unreachable
      ? `The client could not reach the ${appName} API${error?.message ? ` (${error.message})` : ''}. Start the server and try again.`
      : 'The authentication backend is not available. You can browse every screen in preview mode.';

  return (
    <AuthLayout title={title} subtitle={subtitle}>
      <div className="d-flex flex-column gap-2">
        {status === 'unavailable' && (
          <Button icon={Eye} onClick={onPreview} className="iv-auth__submit">
            Browse UI in preview mode
          </Button>
        )}
        <Button variant={status === 'unavailable' ? 'secondary' : 'primary'} icon={RefreshCw} onClick={onRetry} block>
          Retry
        </Button>
        <Button variant="ghost" icon={LogIn} to={ROUTES.login} block>
          Go to sign in
        </Button>
      </div>
    </AuthLayout>
  );
}

/** Maintenance mode (Admin > Access & Limits): only administrators get in. */
function Maintenance({ message, onRetry }) {
  const { logout } = useAuth();
  return (
    <AuthLayout title="Under maintenance" subtitle={message || 'Please try again later.'}>
      <div className="d-flex flex-column gap-2">
        <Button icon={RefreshCw} onClick={onRetry} block>
          Try again
        </Button>
        <Button variant="ghost" icon={LogIn} onClick={() => logout()} block>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  );
}

export default function ProtectedRoute() {
  const { status, error, isAuthenticated, refresh, enablePreview } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="iv-consent-page">
        <Loader label="Loading your workspace" />
      </div>
    );
  }
  if (isAuthenticated) return <Outlet />;

  if (status === 'unauthenticated' || status === 'suspended') {
    return (
      <Navigate
        to={ROUTES.login}
        replace
        state={{ from: location.pathname + location.search, notice: status === 'suspended' ? 'suspended' : undefined }}
      />
    );
  }

  if (status === 'maintenance') return <Maintenance message={error?.message} onRetry={refresh} />;

  return <AuthUnavailable status={status} error={error} onRetry={refresh} onPreview={enablePreview} />;
}
