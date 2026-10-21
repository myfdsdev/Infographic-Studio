import { Compass } from 'lucide-react';
import EmptyState from '../components/common/EmptyState.jsx';
import Button from '../components/common/Button.jsx';
import { ROUTES } from '../utils/constants.js';

export default function NotFound() {
  return (
    <div className="iv-page">
      <div className="iv-container--narrow mx-auto">
        <EmptyState
          icon={Compass}
          title="Page not found"
          description="This page does not exist or the address is wrong."
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
