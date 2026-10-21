import { RotateCw, XCircle, AlertTriangle } from 'lucide-react';
import { StatusBadge } from '../common/Badge.jsx';
import Button from '../common/Button.jsx';
import { JOB_STATUSES, JOB_KINDS } from '../../utils/constants.js';
import { formatDateTime } from '../../utils/formatters.js';

/**
 * Admin job table. Administrators see a prompt preview only (never full
 * inputs or anything key-related), matching what the API returns.
 */
export default function JobsTable({ jobs = [], onRetry, onCancel, busyId }) {
  return (
    <div className="iv-table-wrap">
      <table className="iv-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Type / model</th>
            <th>User</th>
            <th>Status</th>
            <th>Sends</th>
            <th>Updated</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const errorText = job.error ? (typeof job.error === 'string' ? job.error : `${job.error.code}: ${job.error.message}`) : null;
            return (
              <tr key={job.id}>
                <td>
                  <span className="iv-table__primary iv-mono">{String(job.id).slice(-8)}</span>
                  {job.request?.promptPreview && (
                    <span className="iv-table__sub iv-truncate" style={{ maxWidth: 260 }} title={job.request.promptPreview}>
                      {job.request.promptPreview}
                    </span>
                  )}
                  {errorText && (
                    <span className="iv-table__sub iv-truncate text-danger" style={{ maxWidth: 260 }} title={errorText}>
                      {errorText}
                    </span>
                  )}
                </td>
                <td>
                  <span className="iv-table__primary">{JOB_KINDS[job.kind] || job.kind}</span>
                  <span className="iv-table__sub iv-mono">{job.model}</span>
                </td>
                <td>{job.userEmail || job.userId || '-'}</td>
                <td>
                  <StatusBadge status={job.status} map={JOB_STATUSES} />
                  {job.submissionUncertain && job.status !== 'completed' && (
                    <span className="iv-table__sub" title="The provider may have received this request">
                      <AlertTriangle size={12} aria-hidden="true" /> Unconfirmed send
                    </span>
                  )}
                </td>
                <td>{job.submitAttempts ?? '-'}</td>
                <td>{formatDateTime(job.updatedAt || job.createdAt)}</td>
                <td>
                  <div className="iv-table__actions">
                    {onRetry && job.canRetry && (
                      <Button variant="secondary" size="sm" icon={RotateCw} loading={busyId === job.id} onClick={() => onRetry(job)}>
                        Retry
                      </Button>
                    )}
                    {onCancel && job.canCancel && (
                      <Button variant="danger" size="sm" icon={XCircle} loading={busyId === job.id} onClick={() => onCancel(job)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
