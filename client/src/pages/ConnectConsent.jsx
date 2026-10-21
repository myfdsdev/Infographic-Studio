import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, AlertTriangle, Check, X, ExternalLink, LogOut } from 'lucide-react';
import AuthLayout from '../components/layout/AuthLayout.jsx';
import Button from '../components/common/Button.jsx';
import Badge from '../components/common/Badge.jsx';
import { Skeleton } from '../components/common/Loader.jsx';
import { useApiResource } from '../hooks/useApiResource.js';
import { useAuth } from '../hooks/useAuth.js';
import { mcpApi } from '../services/mcpApi.js';
import { errorMessage } from '../services/api.js';
import { ROUTES } from '../utils/constants.js';
import { useBranding } from '../hooks/useBranding.js';

function failureText(error) {
  if (error?.status === 410) return 'This connection request has expired. Start the connection again from your AI app.';
  if (error?.status === 409) return 'This connection request was already answered. If the app did not connect, start again from the app.';
  if (error?.status === 404) return 'This connection request was not found. Start the connection again from your AI app.';
  return errorMessage(error, 'The connection request could not be loaded.');
}

/**
 * The OAuth consent step for an AI app (MCP client). Reached from the
 * authorization server with ?uid=...; the signed-in account decides
 * who is connecting, and the user picks the permissions.
 */
export default function ConnectConsent() {
  const { appName } = useBranding();
  const [params] = useSearchParams();
  const uid = params.get('uid') || '';
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const request = useApiResource((signal) => mcpApi.getConsent(uid, { signal }), [uid], { enabled: Boolean(uid) });
  const info = useApiResource((signal) => mcpApi.info({ signal }));
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(null);
  const [failure, setFailure] = useState('');
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (request.data?.scopes) setSelected(request.data.scopes.map((scope) => scope.id));
  }, [request.data]);

  const toggle = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));

  const answer = async (kind) => {
    setBusy(kind);
    setFailure('');
    try {
      const result = kind === 'approve' ? await mcpApi.approveConsent(uid, selected) : await mcpApi.denyConsent(uid);
      setLeaving(true);
      // Back to the authorization server, which returns to the app.
      window.location.assign(result.redirectTo);
    } catch (error) {
      setFailure(failureText(error));
      setBusy(null);
    }
  };

  const switchAccount = async () => {
    await logout();
    navigate(ROUTES.login, { replace: true, state: { from: location.pathname + location.search } });
  };

  if (!uid) {
    return (
      <AuthLayout title="Connection request missing" subtitle="Open this page from your AI app's connect flow.">
        <Button variant="secondary" to={ROUTES.mcp} block>
          Go to MCP Connection
        </Button>
      </AuthLayout>
    );
  }

  if (request.loading) {
    return (
      <AuthLayout title="Connect an AI app" subtitle="Loading the request...">
        <Skeleton height={180} />
      </AuthLayout>
    );
  }

  if (request.error) {
    return (
      <AuthLayout title="Cannot continue" subtitle={failureText(request.error)}>
        <Button variant="secondary" to={ROUTES.mcp} block>
          Go to MCP Connection
        </Button>
      </AuthLayout>
    );
  }

  const { client, scopes, account } = request.data;
  const tokens = info.data?.tokens;
  const paidSelected = scopes.filter((scope) => scope.paid && selected.includes(scope.id));

  return (
    <AuthLayout wide title={`Connect ${client.name} to ${appName}?`} subtitle={`Signed in as ${account.name} (${account.email})`}>
      <div className="d-flex flex-column gap-3">
        <div className="iv-consent-app">
          <dl className="iv-consent-app__facts">
            <div>
              <dt>App</dt>
              <dd>{client.name}</dd>
            </div>
            <div>
              <dt>{client.registration === 'metadata_document' ? 'Identity published by' : 'Registered'}</dt>
              <dd>{client.registration === 'metadata_document' ? client.publishedBy : `Automatically by the app (${appName} cannot verify who runs it)`}</dd>
            </div>
            <div>
              <dt>After approval you return to</dt>
              <dd className="iv-mono">{client.redirectHost || 'unknown'}</dd>
            </div>
          </dl>
          {client.loopbackOnly && (
            <p className="iv-consent-warning" role="note">
              <AlertTriangle size={14} aria-hidden="true" /> This app returns to a program on your own computer (localhost). Any program on
              this device could claim that name: approve only if you just started this connection from an app you trust.
            </p>
          )}
          {client.registration !== 'metadata_document' && !client.loopbackOnly && (
            <p className="iv-consent-note">Only approve if you just added {appName} in this app yourself.</p>
          )}
        </div>

        <fieldset className="iv-scopes">
          <legend className="iv-field__label">Allow this app to</legend>
          {scopes.map((scope) => (
            <label key={scope.id} className="iv-scope">
              <input type="checkbox" className="form-check-input" checked={selected.includes(scope.id)} onChange={() => toggle(scope.id)} disabled={Boolean(busy)} />
              <span className="iv-scope__text">
                <span className="d-flex align-items-center gap-2 flex-wrap">
                  <strong>{scope.label}</strong>
                  {scope.paid && <Badge tone="warning">Uses your Kie.ai credits</Badge>}
                </span>
                <span className="iv-muted small">{scope.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="iv-consent-note">
          <ShieldCheck size={14} aria-hidden="true" /> The app acts as you and sees only your own infographics. Your Kie.ai key stays
          on the {appName} server.{' '}
          {paidSelected.length > 0 ? 'It can start paid generations; good apps ask you first, and each tool says when it costs credits.' : 'It cannot start paid generations.'}{' '}
          {tokens ? `Access renews automatically; an unused connection ends after ${tokens.refreshTokenIdleDays} days.` : ''} Revoke it anytime on
          the MCP Connection page.
        </div>

        {failure && (
          <div className="iv-field__error" role="alert">
            {failure}
          </div>
        )}

        <div className="d-flex flex-column flex-sm-row gap-2">
          <Button icon={Check} onClick={() => answer('approve')} loading={busy === 'approve' || (leaving && busy === 'approve')} disabled={Boolean(busy) || selected.length === 0} block>
            Approve
          </Button>
          <Button variant="secondary" icon={X} onClick={() => answer('deny')} loading={busy === 'deny'} disabled={Boolean(busy)} block>
            Deny
          </Button>
        </div>
        {selected.length === 0 && <p className="iv-muted small mb-0">Allow at least one permission, or choose Deny.</p>}

        <div className="d-flex justify-content-between flex-wrap gap-2">
          <Button variant="ghost" size="sm" icon={LogOut} onClick={switchAccount} disabled={Boolean(busy)}>
            Use a different account
          </Button>
          <Button variant="ghost" size="sm" icon={ExternalLink} to={ROUTES.mcp} disabled={Boolean(busy)}>
            About MCP connections
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
