import { useState } from 'react';
import { Link } from 'react-router-dom';
import Card from '../../components/common/Card.jsx';
import Badge from '../../components/common/Badge.jsx';
import Select from '../../components/common/Select.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import { Skeleton } from '../../components/common/Loader.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { adminApi } from '../../services/adminApi.js';
import { JOB_ERROR_HELP, ROUTES } from '../../utils/constants.js';
import { formatDateTime, formatRelative } from '../../utils/formatters.js';
import { CheckCircle2 } from 'lucide-react';

const RANGES = [
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];

function GroupTable({ groups, withModels }) {
  return (
    <div className="table-responsive">
      <table className="iv-table">
        <thead>
          <tr>
            <th>Error</th>
            <th>Count</th>
            {withModels && <th>Models</th>}
            <th>Latest</th>
            <th>Example message</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.code}>
              <td>
                <span className="iv-mono small d-block">{group.code}</span>
                {JOB_ERROR_HELP[group.code] && <span className="iv-table__sub">{JOB_ERROR_HELP[group.code]}</span>}
              </td>
              <td>
                <Badge tone="danger">{group.count}</Badge>
              </td>
              {withModels && <td className="small iv-mono">{(group.models || []).join(', ')}</td>}
              <td className="small text-nowrap">{formatRelative(group.lastAt)}</td>
              <td className="small iv-muted">{group.sample || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Failed generation jobs grouped by error, with messages passed through server-side redaction. */
export default function Failures() {
  const [days, setDays] = useState('7');
  const { data, loading, error, reload } = useApiResource((signal) => adminApi.failures({ days }, { signal }), [days]);

  return (
    <div className="d-flex flex-column gap-4">
      <Card
        title={"Failures"}
        subtitle="Grouped by error code. Messages are redacted on the server: keys, tokens and signed URLs are removed; prompts are never shown."
        actions={<Select aria-label="Time range" value={days} onChange={(event) => setDays(event.target.value)} options={RANGES} />}
      >
        {loading && !data ? (
          <Skeleton height={160} />
        ) : error ? (
          <ErrorState plain title="Could not load failures" error={error} onRetry={reload} />
        ) : data.jobs.length === 0 ? (
          <EmptyState plain icon={CheckCircle2} title="No failures in this period" description="Failed generation jobs would appear here." />
        ) : (
          <div className="d-flex flex-column gap-4">
            {data.jobs.length > 0 && (
              <div>
                <h3 className="iv-card__title mb-2">Generation jobs</h3>
                <GroupTable groups={data.jobs} withModels />
              </div>
            )}
          </div>
        )}
      </Card>

      {data && data.recentJobs.length > 0 && (
        <Card title="Recent failed jobs" subtitle="Newest first. Retry or cancel from Jobs.">
          <div className="table-responsive">
            <table className="iv-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Model</th>
                  <th>Error</th>
                  <th>Attempts</th>
                </tr>
              </thead>
              <tbody>
                {data.recentJobs.map((job) => (
                  <tr key={job.id}>
                    <td className="small text-nowrap">{formatDateTime(job.at)}</td>
                    <td className="small">{job.userEmail || '-'}</td>
                    <td className="small iv-mono">{job.model}</td>
                    <td className="small">
                      <span className="iv-mono d-block">{job.code}</span>
                      <span className="iv-table__sub">{job.message}</span>
                    </td>
                    <td className="small">{job.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link to={ROUTES.adminJobs} className="small d-inline-block mt-2">
            Open Jobs
          </Link>
        </Card>
      )}
    </div>
  );
}
