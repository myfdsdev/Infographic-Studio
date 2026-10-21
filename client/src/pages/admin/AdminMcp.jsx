import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plug, Activity, AlertTriangle, CheckCircle2, Unplug } from 'lucide-react';
import Card from '../../components/common/Card.jsx';
import Badge from '../../components/common/Badge.jsx';
import Select from '../../components/common/Select.jsx';
import StatsCard from '../../components/admin/StatsCard.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import { Skeleton } from '../../components/common/Loader.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { adminApi } from '../../services/adminApi.js';
import { formatDateTime, formatRelative } from '../../utils/formatters.js';
import Connections from './Connections.jsx';

const RANGES = [
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];

/** MCP operational status, tool usage and integration errors, plus every connection. */
export default function AdminMcp() {
  const { refreshKey } = useOutletContext() || {};
  const [days, setDays] = useState('7');
  const { data, loading, error, reload } = useApiResource((signal) => adminApi.mcpMonitor({ days }, { signal }), [days, refreshKey]);
  const monitor = data?.monitor;
  const calls = monitor ? monitor.tools.reduce((sum, row) => sum + row.calls, 0) : 0;
  const failures = monitor ? monitor.tools.reduce((sum, row) => sum + row.failures, 0) : 0;

  return (
    <div className="d-flex flex-column gap-4">
      {loading && !monitor ? (
        <Skeleton height={96} />
      ) : error ? (
        <Card>
          <ErrorState plain title="Could not load MCP monitoring" error={error} onRetry={reload} />
        </Card>
      ) : (
        <>
          <div className="iv-stat-grid">
            <StatsCard label="Server status" value={monitor.enabled ? 'Online' : 'Off'} icon={monitor.enabled ? CheckCircle2 : AlertTriangle} tone={monitor.enabled ? 'ok' : 'danger'} hint={monitor.url} />
            <StatsCard label="Active connections" value={monitor.connections.active} icon={Plug} hint={monitor.connections.lastUsedAt ? `last used ${formatRelative(monitor.connections.lastUsedAt)}` : 'not used yet'} />
            <StatsCard label="Tool calls" value={calls} icon={Activity} hint={RANGES.find((r) => r.value === days)?.label} />
            <StatsCard label="Failed calls" value={failures} icon={AlertTriangle} tone={failures ? 'danger' : 'ok'} hint={calls ? `${Math.round((failures / calls) * 100)}% of calls` : null} />
          </div>

          <div className="row g-4">
            <div className="col-lg-6">
              <Card title="Tool usage" actions={<Select aria-label="Time range" value={days} onChange={(event) => setDays(event.target.value)} options={RANGES} />}>
                {monitor.tools.length === 0 ? (
                  <EmptyState plain icon={Activity} title="No tool calls yet" description="Calls from connected assistants appear here." />
                ) : (
                  <div className="iv-table-wrap">
                    <table className="iv-table">
                      <thead>
                        <tr>
                          <th>Tool</th>
                          <th>Calls</th>
                          <th>Failed</th>
                          <th>Last call</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monitor.tools.map((row) => (
                          <tr key={row.tool}>
                            <td className="iv-mono">{row.tool}</td>
                            <td>{row.calls}</td>
                            <td>{row.failures ? <Badge tone="danger">{row.failures}</Badge> : 0}</td>
                            <td title={formatDateTime(row.lastAt)}>{formatRelative(row.lastAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
            <div className="col-lg-6">
              <Card title="Integration errors" subtitle="Recent failed tool calls. Arguments are never shown here.">
                {monitor.recentFailures.length === 0 ? (
                  <EmptyState plain icon={CheckCircle2} title="No errors" description="Failed tool calls would appear here." />
                ) : (
                  <ul className="iv-activity">
                    {monitor.recentFailures.map((row) => (
                      <li key={row.id}>
                        <Unplug size={14} className="text-danger mt-1" aria-hidden="true" />
                        <div className="iv-activity__body">
                          <div className="iv-activity__summary">
                            <span className="iv-mono">{row.tool}</span> · <Badge tone="danger">{row.code}</Badge>
                          </div>
                          <span className="small iv-muted">
                            {row.userEmail || 'unknown user'}
                            {row.client ? ` via ${row.client}` : ''}
                          </span>
                        </div>
                        <span className="iv-activity__time" title={formatDateTime(row.at)}>
                          {formatRelative(row.at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
      <Connections />
    </div>
  );
}
