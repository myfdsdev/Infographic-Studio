import { ExternalLink } from 'lucide-react';
import Button from '../common/Button.jsx';
import { JOB_ERROR_HELP } from '../../utils/constants.js';

/** The provider's reason plus what the user can do about it. */
export default function ErrorHelp({ error }) {
  if (!error) return null;
  const help = JOB_ERROR_HELP[error.code];
  return (
    <div className="d-flex flex-column align-items-center gap-2">
      {error.message && <p className="iv-muted small mb-0">{error.message}</p>}
      {help?.text && <p className="small mb-0">{help.text}</p>}
      {help?.to && (
        <Button size="sm" variant="secondary" to={help.to}>
          {help.action}
        </Button>
      )}
      {help?.href && (
        <Button size="sm" variant="secondary" href={help.href} iconRight={ExternalLink}>
          {help.action}
        </Button>
      )}
    </div>
  );
}
