import { Link, useOutletContext } from 'react-router-dom';
import { Users, Images, CheckCircle2, XCircle, Plug, KeyRound, Database, HardDrive, Mail, ArrowRight, Activity, Wrench } from 'lucide-react';
import Card from '../../components/common/Card.jsx';
import Badge from '../../components/common/Badge.jsx';
import StatsCard from '../../components/admin/StatsCard.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import { Skeleton } from '../../components/common/Loader.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { adminApi } from '../../services/adminApi.js';
import { getReadiness } from '../../services/systemApi.js';
import { ROUTES } from '../../utils/constants.js';
import { displayNameOf, formatRelative } from '../../utils/formatters.js';

function HealthRow({ icon: Icon, label, ok, detail, warn = false }) {
  return (
    <div className="d-flex align-items-start gap-3 py-2">
      <Icon size={18} className="flex-shrink-0 mt-1 iv-muted" aria-hidden="true" />
      <div className="flex-grow-1 min-w-0">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <strong className="small">{label}</strong>
          <Badge tone={ok ? 'ok' : warn ? 'warning' : 'danger'}>{ok ? 'OK' : warn ? 'Attention' : 'Failing'}</Badge>
        </div>
        {detail && <span className="small iv-muted d-block">{detail}</span>}
      </div>
    </div>
  );
}

function Share({ label, value, total }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="d-flex flex-column gap-1">
      <div className="d-flex justify-content-between small">
        <span>{label}</span>
        <span className="iv-muted">
          {value} · {pct}%
        </span>
      </div>
      <div className="iv-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Overview: the headline numbers, live health and recent sign-ups. */
export default function AdminDashboard() {
  const { refreshKey, stats, statsLoading } = useOutletContext() || {};
  const health = useApiResource((signal) => getReadiness({ signal }), [refreshKey]);
  const signups = useApiResource((signal) => adminApi.listUsers({ limit: 6 }, { signal }), [refreshKey]);

  const ig = stats?.infographics;
  const loading = statsLoading && !stats?.users;
  const tiles = [
    { label: 'Total users', value: stats?.users?.total, icon: Users, hint: stats?.users ? `${stats.users.new7d} new in 7 days` : null },
    { label: 'Total generations', value: ig?.total, icon: Images, hint: ig ? `${ig.created24h} in the last 24 h` : null },
    { label: 'Successful', value: ig?.completed, icon: CheckCircle2, tone: 'ok', hint: ig?.active ? `${ig.active} in progress` : null },
    { label: 'Failed', value: ig?.failed, icon: XCircle, tone: 'danger', hint: ig?.cancelled ? `${ig.cancelled} cancelled` : null },
    { label: 'MCP connections', value: stats?.mcp?.activeConnections, icon: Plug, tone: 'warning', hint: stats?.mcp ? `${stats.mcp.toolCalls24h} tool calls in 24 h` : null },
    { label: 'Users with a key', value: stats?.keys?.usersWithKey, icon: KeyRound, hint: stats?.keys?.invalid ? `${stats.keys.invalid} rejected` : 'BYOK, never shown' },
  ];
  const checks = health.data?.checks || {};
  const email = checks.email || {};
  const finished = ig ? ig.completed + ig.failed : 0;

  return (
    <div className="d-flex flex-column gap-4">
      <div className="iv-stat-grid">
        {tiles.map((tile) => (loading ? <Skeleton key={tile.label} height={96} /> : <StatsCard key={tile.label} {...tile} />))}
      </div>

      <div className="row g-4">
        <div className="col-lg-7 d-flex flex-column gap-4">
          <Card title="Generation usage" subtitle="All-time results and the styles people choose." actions={<Link to={ROUTES.adminGenerations} className="small fw-semibold d-inline-flex align-items-center gap-1">Monitor <ArrowRight size={12} /></Link>}>
            {!ig ? (
              <p className="iv-muted mb-0">Statistics are not available.</p>
            ) : ig.total === 0 ? (
              <p className="iv-muted mb-0">No infographics have been generated yet.</p>
            ) : (
              <div className="d-flex flex-column gap-3">
                <Share label="Success rate (finished)" value={ig.completed} total={finished} />
                <Share label="Minimal" value={ig.byStyle?.minimal || 0} total={ig.total} />
                <Share label="Corporate" value={ig.byStyle?.corporate || 0} total={ig.total} />
                <Share label="Colorful" value={ig.byStyle?.colorful || 0} total={ig.total} />
                <Share label="Started through MCP" value={ig.bySource?.mcp || 0} total={ig.total} />
              </div>
            )}
          </Card>

          <Card title="Jobs and MCP" subtitle="Provider jobs and assistant activity in the last 24 hours.">
            {!stats?.jobs ? (
              <p className="iv-muted mb-0">Statistics are not available.</p>
            ) : (
              <dl className="iv-kv">
                <div className="iv-kv__row">
                  <dt>Jobs queued / running</dt>
                  <dd>
                    {stats.jobs.queued} / {stats.jobs.processing}
                  </dd>
                </div>
                <div className="iv-kv__row">
                  <dt>Jobs created / completed / failed</dt>
                  <dd>
                    {stats.jobs.created24h} / {stats.jobs.completed24h} / {stats.jobs.failed24h}
                  </dd>
                </div>
                <div className="iv-kv__row">
                  <dt>MCP tool calls (failed)</dt>
                  <dd>
                    {stats.mcp.toolCalls24h} ({stats.mcp.toolFailures24h})
                  </dd>
                </div>
                <div className="iv-kv__row">
                  <dt>Server errors logged</dt>
                  <dd>{stats.ops.errors24h}</dd>
                </div>
              </dl>
            )}
          </Card>
        </div>

        <div className="col-lg-5 d-flex flex-column gap-4">
          <Card title="System health" subtitle="Live readiness reported by the API.">
            {health.loading && !health.data ? (
              <Skeleton height={140} />
            ) : health.error ? (
              <ErrorState plain title="Could not read system health" error={health.error} onRetry={health.reload} />
            ) : (
              <>
                <HealthRow icon={Database} label="MongoDB" ok={Boolean(checks.database?.ok)} detail={checks.database?.ok ? `Database "${checks.database.name}"` : checks.database?.lastError || checks.database?.state} />
                <HealthRow icon={HardDrive} label="Storage" ok={Boolean(checks.storage?.ok)} detail={checks.storage?.driver === 's3' ? 'S3-compatible bucket' : 'Local disk (development only)'} />
                <HealthRow icon={Mail} label="Email delivery" ok={Boolean(email.deliversToInbox)} warn={!email.deliversToInbox} detail={email.note || `Provider: ${email.provider || 'unknown'}`} />
                <Link to={ROUTES.adminOperations} className="small d-inline-flex align-items-center gap-1 mt-2">
                  <Wrench size={12} /> Operations <ArrowRight size={12} />
                </Link>
              </>
            )}
          </Card>

          <Card title="Recent sign-ups" actions={<Link to={ROUTES.adminUsers} className="small fw-semibold">All users</Link>}>
            {signups.loading && !signups.data ? (
              <Skeleton height={120} />
            ) : signups.error ? (
              <ErrorState plain title="Could not load users" error={signups.error} onRetry={signups.reload} />
            ) : (
              <ul className="iv-activity">
                {(signups.data?.items || []).map((user) => (
                  <li key={user.id}>
                    <Activity size={14} className="iv-muted mt-1" aria-hidden="true" />
                    <div className="iv-activity__body">
                      <Link to={ROUTES.adminUser(user.id)} className="iv-activity__summary fw-semibold d-block">
                        {displayNameOf(user)}
                      </Link>
                      <span className="small iv-muted">{user.email}</span>
                    </div>
                    <span className="iv-activity__time">{formatRelative(user.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
