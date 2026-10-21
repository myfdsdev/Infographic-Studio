import { useEffect, useState } from 'react';
import { Activity, Search, RefreshCw } from 'lucide-react';
import Card from '../../components/common/Card.jsx';
import Input from '../../components/common/Input.jsx';
import Select from '../../components/common/Select.jsx';
import Button from '../../components/common/Button.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import IntegrationPending from '../../components/common/IntegrationPending.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import { Skeleton } from '../../components/common/Loader.jsx';
import JobsTable from '../../components/admin/JobsTable.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { useToast } from '../../hooks/useToast.js';
import { adminApi } from '../../services/adminApi.js';
import { errorMessage } from '../../services/api.js';
import { JOB_STATUSES, JOB_KINDS } from '../../utils/constants.js';

const PAGE_SIZE = 25;

export default function Jobs() {
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);
  const [confirmJob, setConfirmJob] = useState(null);

  // Debounce the search box; filtering happens on the server.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, loading, error, notImplemented, reload } = useApiResource(
    (signal) => adminApi.listJobs({ status, kind, search: search || undefined, page, limit: PAGE_SIZE }, { signal }),
    [status, kind, search, page],
  );
  const items = data?.items || [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const act = async (fn, job, label) => {
    setBusyId(job.id);
    try {
      await fn();
      toast.success(`Job ${label}`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const retry = (job) => {
    if (job.retryNeedsConfirmation) setConfirmJob(job);
    else act(() => adminApi.retryJob(job.id), job, 'queued again');
  };

  return (
    <div className="d-flex flex-column gap-3">
      <Card
        title="Generation jobs"
        subtitle="Every queued, running, finished and failed job across the platform. Prompts are shown as a short preview only."
        actions={
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={reload} loading={loading}>
            Refresh
          </Button>
        }
      >
        <div className="iv-filters">
          <Input
            icon={Search}
            placeholder="Search by user email, job id, task id or model"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            aria-label="Search jobs"
          />
          <div className="iv-field iv-field--fixed">
            <Select
              aria-label="Status filter"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              options={[{ value: 'all', label: 'All statuses' }, ...Object.entries(JOB_STATUSES).map(([value, entry]) => ({ value, label: entry.label }))]}
            />
          </div>
          <div className="iv-field iv-field--fixed">
            <Select
              aria-label="Type filter"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value);
                setPage(1);
              }}
              options={[{ value: 'all', label: 'All types' }, ...Object.entries(JOB_KINDS).map(([value, label]) => ({ value, label }))]}
            />
          </div>
        </div>
      </Card>

      <Card
        title={`Jobs${!loading && !notImplemented && !error ? ` (${total})` : ''}`}
        pad={false}
        footer={
          pages > 1 ? (
            <div className="d-flex align-items-center gap-2 w-100 justify-content-end">
              <span className="iv-muted small">
                Page {page} of {pages}
              </span>
              <Button variant="secondary" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          ) : null
        }
      >
        {loading && !data ? (
          <div className="p-3">
            <Skeleton height={200} />
          </div>
        ) : notImplemented ? (
          <div className="p-3">
            <IntegrationPending compact endpoint="GET /api/admin/jobs" title="Job listing not reachable" />
          </div>
        ) : error ? (
          <ErrorState plain title="Could not load jobs" error={error} onRetry={reload} />
        ) : items.length === 0 ? (
          <EmptyState plain icon={Activity} title={status === 'all' && kind === 'all' && !search ? 'No jobs yet' : 'No jobs match these filters'} />
        ) : (
          <JobsTable
            jobs={items}
            busyId={busyId}
            onRetry={retry}
            onCancel={(job) => act(() => adminApi.cancelJob(job.id), job, job.status === 'queued' ? 'cancelled' : 'cancellation requested')}
          />
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(confirmJob)}
        title="Retry and risk a second charge?"
        message="This job's first request may already have reached the provider, which bills the user's own account. Retrying sends a new request that can be charged again."
        confirmLabel="Retry anyway"
        danger
        loading={Boolean(confirmJob) && busyId === confirmJob?.id}
        onConfirm={async () => {
          const job = confirmJob;
          await act(() => adminApi.retryJob(job.id, { confirmDuplicateRisk: true }), job, 'queued again');
          setConfirmJob(null);
        }}
        onCancel={() => setConfirmJob(null)}
      />
    </div>
  );
}
