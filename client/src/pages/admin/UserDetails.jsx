import { useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { ArrowLeft, UserX, UserCheck, ShieldPlus, ShieldMinus, History, Unplug, ScanEye } from 'lucide-react';
import Card from '../../components/common/Card.jsx';
import Button from '../../components/common/Button.jsx';
import Badge, { StatusBadge } from '../../components/common/Badge.jsx';
import IntegrationPending from '../../components/common/IntegrationPending.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import Loader from '../../components/common/Loader.jsx';
import UserActionDialog from '../../components/admin/UserActionDialog.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { useToast } from '../../hooks/useToast.js';
import { errorMessage } from '../../services/api.js';
import { useAuth } from '../../hooks/useAuth.js';
import { adminApi } from '../../services/adminApi.js';
import { ROUTES, CREDENTIAL_STATUSES, PROVIDER } from '../../utils/constants.js';
import { displayNameOf, formatDateTime, formatRelative, initialsOf, titleCase } from '../../utils/formatters.js';

function BackLink() {
  return (
    <Link to={ROUTES.adminUsers} className="iv-page-header__back">
      <ArrowLeft size={14} /> Users
    </Link>
  );
}

export default function UserDetails() {
  const { id } = useParams();
  const { refreshKey, refreshAdmin } = useOutletContext() || {};
  const { user: me, startActingAs } = useAuth();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const [confirmActAs, setConfirmActAs] = useState(false);
  const [startingActAs, setStartingActAs] = useState(false);
  const [action, setAction] = useState(null);
  const [pendingRevoke, setPendingRevoke] = useState(null);
  const [revoking, setRevoking] = useState(false);
  const { toast } = useToast();
  const { data, loading, error, notImplemented, reload } = useApiResource(
    (signal) => adminApi.getUser(id, { signal }),
    [id, refreshKey, tick],
  );

  if (loading && !data) return <Loader label="Loading user" />;

  if (notImplemented) {
    return (
      <div>
        <BackLink />
        <IntegrationPending endpoint={`GET /api/admin/users/${id}`} title="User details not connected yet" />
      </div>
    );
  }

  if (error || !data?.user) {
    const missing = error?.status === 404 || error?.status === 400;
    return (
      <div>
        <BackLink />
        <ErrorState
          plain
          title={missing ? 'User not found' : 'Could not load this user'}
          error={missing ? 'The account may have been deleted, or the link is wrong.' : error}
          onRetry={missing ? undefined : reload}
        />
      </div>
    );
  }

  const { user, activeSessions, recentActivity = [], credentials = [], mcpConnections = [], usage } = data;

  const revokeConnection = async () => {
    setRevoking(true);
    try {
      await adminApi.revokeConnection(pendingRevoke.id);
      toast.success('AI connection revoked');
      setPendingRevoke(null);
      setTick((value) => value + 1);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRevoking(false);
    }
  };
  const isSelf = user.id === me?.id;
  // The server enforces the same rules (services/actAs.service.js).
  const canActAs = !isSelf && user.role !== 'admin' && user.status === 'active';

  const actAsUser = async () => {
    setStartingActAs(true);
    try {
      await startActingAs(user.id);
      navigate(ROUTES.dashboard);
    } catch (err) {
      toast.error(errorMessage(err));
      setStartingActAs(false);
    }
  };

  const done = () => {
    setTick((value) => value + 1);
    refreshAdmin?.();
  };

  return (
    <div className="d-flex flex-column gap-4">
      <div>
        <BackLink />
        <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
          <div className="d-flex align-items-center gap-3">
            <span className="iv-avatar iv-avatar--lg" aria-hidden="true">
              {initialsOf(user.name || user.email)}
            </span>
            <div>
              <h2 className="iv-page-header__title">
                {displayNameOf(user)}
                {isSelf && <span className="iv-muted fw-normal fs-6"> (you)</span>}
              </h2>
              <p className="mb-1 iv-muted">{user.email}</p>
              <div className="d-flex gap-2 flex-wrap">
                <Badge tone={user.status === 'active' ? 'ok' : 'danger'}>{user.status}</Badge>
                {user.role === 'admin' ? <Badge tone="accent">Admin</Badge> : <Badge>User</Badge>}
              </div>
            </div>
          </div>
          {!isSelf && (
            <div className="d-flex gap-2 flex-wrap">
              {canActAs && (
                <Button variant="secondary" icon={ScanEye} onClick={() => setConfirmActAs(true)}>
                  Act as user
                </Button>
              )}
              {user.role === 'admin' ? (
                <Button variant="secondary" icon={ShieldMinus} onClick={() => setAction('demote')}>
                  Remove admin role
                </Button>
              ) : (
                <Button variant="secondary" icon={ShieldPlus} onClick={() => setAction('promote')}>
                  Make admin
                </Button>
              )}
              {user.status === 'suspended' ? (
                <Button icon={UserCheck} onClick={() => setAction('reactivate')}>
                  Reactivate
                </Button>
              ) : (
                <Button variant="danger" icon={UserX} onClick={() => setAction('suspend')}>
                  Suspend
                </Button>
              )}
            </div>
          )}
        </div>
        {isSelf && (
          <p className="iv-field__hint mt-2 mb-0">You cannot change your own role or status. Ask another administrator.</p>
        )}
      </div>

      <div className="row g-4">
        <div className="col-lg-5 d-flex flex-column gap-4">
          <Card title="Account">
            <dl className="iv-kv">
              <div className="iv-kv__row">
                <dt>Joined</dt>
                <dd>{formatDateTime(user.createdAt)}</dd>
              </div>
              <div className="iv-kv__row">
                <dt>Last sign-in</dt>
                <dd>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}</dd>
              </div>
              <div className="iv-kv__row">
                <dt>Password changed</dt>
                <dd>{user.passwordChangedAt ? formatDateTime(user.passwordChangedAt) : 'Never'}</dd>
              </div>
              <div className="iv-kv__row">
                <dt>Active sessions</dt>
                <dd>{activeSessions}</dd>
              </div>
              <div className="iv-kv__row">
                <dt>User id</dt>
                <dd className="iv-mono">{user.id}</dd>
              </div>
            </dl>
          </Card>

          <Card title="API keys" subtitle="Provider and status only. Keys and their digits are never shown to administrators.">
            {credentials.length === 0 ? (
              <p className="iv-muted mb-0">No provider key saved.</p>
            ) : (
              <dl className="iv-kv">
                {credentials.map((credential) => (
                  <div key={credential.provider} className="iv-kv__row">
                    <dt>{credential.provider === PROVIDER.key ? PROVIDER.name : credential.provider}</dt>
                    <dd>
                      <StatusBadge status={credential.status} map={CREDENTIAL_STATUSES} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          {usage && (
            <Card title="Usage">
              <dl className="iv-kv">
                <div className="iv-kv__row">
                  <dt>Infographics</dt>
                  <dd>{usage.infographics}</dd>
                </div>
                <div className="iv-kv__row">
                  <dt>Completed / failed</dt>
                  <dd>
                    {usage.infographicsCompleted} / {usage.infographicsFailed}
                  </dd>
                </div>
                <div className="iv-kv__row">
                  <dt>Generation jobs (failed)</dt>
                  <dd>
                    {usage.jobs} ({usage.failedJobs})
                  </dd>
                </div>
              </dl>
            </Card>
          )}

          <Card title="AI connections" subtitle="AI apps this user approved (MCP). Revoking signs the app out at once.">
            {mcpConnections.length === 0 ? (
              <p className="iv-muted mb-0">No AI app connected.</p>
            ) : (
              <ul className="iv-list-reset d-flex flex-column gap-2">
                {mcpConnections.map((connection) => (
                  <li key={connection.id} className="d-flex justify-content-between align-items-center gap-2">
                    <span className="min-w-0">
                      <strong className="d-block iv-truncate">{connection.clientName}</strong>
                      <span className="small iv-muted">
                        {connection.status === 'active' ? 'Active' : `Revoked (${connection.revokedReason || 'unknown'})`} · approved{' '}
                        {formatDateTime(connection.createdAt)}
                        {connection.lastUsedAt ? ` · last used ${formatRelative(connection.lastUsedAt)}` : ''}
                      </span>
                    </span>
                    {connection.status === 'active' && (
                      <Button variant="danger" size="sm" icon={Unplug} onClick={() => setPendingRevoke(connection)}>
                        Revoke
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {user.status === 'suspended' && (
            <Card title="Suspension">
              <dl className="iv-kv">
                <div className="iv-kv__row">
                  <dt>Suspended</dt>
                  <dd>{formatDateTime(user.suspendedAt)}</dd>
                </div>
                <div className="iv-kv__row flex-column align-items-start gap-1">
                  <dt>Reason</dt>
                  <dd className="text-start">{user.suspendedReason || <span className="iv-dim">No reason recorded</span>}</dd>
                </div>
              </dl>
            </Card>
          )}
        </div>

        <div className="col-lg-7">
          <Card title="Recent activity" subtitle="Audit entries where this account is the actor or the target.">
            {recentActivity.length === 0 ? (
              <EmptyState plain icon={History} title="No activity recorded" />
            ) : (
              <ul className="iv-activity">
                {recentActivity.map((entry) => (
                  <li key={entry.id}>
                    <span className="iv-activity__time" title={formatDateTime(entry.createdAt)}>
                      {formatRelative(entry.createdAt)}
                    </span>
                    <span className="iv-activity__body">
                      <strong>{titleCase(entry.action.replace(/\./g, ' '))}</strong>{' '}
                      {entry.outcome === 'failure' && <Badge tone="danger">failed</Badge>}
                      <span className="iv-activity__summary">
                        {entry.actorEmail && entry.actorEmail !== user.email ? `by ${entry.actorEmail}` : ''}
                        {entry.summary ? `${entry.actorEmail && entry.actorEmail !== user.email ? ' · ' : ''}${entry.summary}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingRevoke)}
        title="Revoke this AI connection?"
        message={`${pendingRevoke?.clientName || 'The app'} loses access to this account at once.`}
        confirmLabel="Revoke"
        danger
        loading={revoking}
        onConfirm={revokeConnection}
        onCancel={() => setPendingRevoke(null)}
      />
      <ConfirmDialog
        open={confirmActAs}
        title={`View the app as ${displayNameOf(user)}?`}
        confirmLabel="Act as user"
        loading={startingActAs}
        onConfirm={actAsUser}
        onCancel={() => setConfirmActAs(false)}
      >
        <ul className="iv-muted small mb-0 ps-3 d-flex flex-column gap-1">
          <li>You see their workspace, generations and settings exactly as they do.</li>
          <li>Read-only: nothing can be changed, uploaded or generated, so their provider credit is never used.</li>
          <li>Their API key and its digits stay hidden.</li>
          <li>It ends when you click Exit or sign out, or after 60 minutes. Start and end go into the audit log.</li>
        </ul>
      </ConfirmDialog>
      <UserActionDialog action={action} user={user} onClose={() => setAction(null)} onDone={done} />
    </div>
  );
}
