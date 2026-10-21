import { Outlet } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import EmptyState from '../components/common/EmptyState.jsx';
import Button from '../components/common/Button.jsx';
import { ROUTES } from '../utils/constants.js';

/**
 * Client-side gate for admin screens. This only hides UI; the backend enforces
 * the admin role on every /api/admin route.
 */
export default function AdminRoute() {
  const { isAdmin } = useAuth();
  if (!isAdmin) {
    return (
      <div className="iv-page">
        <div className="iv-container--narrow mx-auto">
          <EmptyState
            icon={Shield}
            title="Access denied"
            description="You need admin privileges to open this area."
            action={
              <Button variant="secondary" to={ROUTES.dashboard}>
                Back to dashboard
              </Button>
            }
          />
        </div>
      </div>
    );
  }
  return <Outlet />;
}
