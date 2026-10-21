import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScanEye } from 'lucide-react';
import Button from '../common/Button.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../hooks/useToast.js';
import { errorMessage } from '../../services/api.js';
import { ROUTES } from '../../utils/constants.js';
import { displayNameOf } from '../../utils/formatters.js';

const timeOf = (value) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Shown on every page while an administrator views the app as a user. */
export default function ActingAsBanner() {
  const { user, actingAs, stopActingAs, refresh } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [leaving, setLeaving] = useState(false);

  if (!actingAs || !user) return null;

  const exit = async () => {
    setLeaving(true);
    const viewedId = user.id;
    try {
      const result = await stopActingAs();
      navigate(ROUTES.adminUser(result?.viewedUserId || viewedId), { replace: true });
    } catch (err) {
      // The view may already have ended on the server; re-read the session.
      await refresh();
      toast.error(errorMessage(err));
    } finally {
      setLeaving(false);
    }
  };

  return (
    <div className="iv-banner" role="status">
      <ScanEye size={16} aria-hidden="true" />
      <span>
        <strong>Viewing as {displayNameOf(user)}</strong>
        <span className="iv-actas-banner__detail">
          {' '}
          ({user.email}). Read-only: you see what this user sees, but nothing can be changed or generated. Ends at{' '}
          {timeOf(actingAs.expiresAt)}.
        </span>
        <span className="iv-actas-banner__short"> · read-only</span>
      </span>
      <Button variant="secondary" size="sm" onClick={exit} loading={leaving}>
        Exit
      </Button>
    </div>
  );
}
