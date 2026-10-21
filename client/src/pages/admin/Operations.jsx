import { useEffect, useState } from 'react';
import { Search, Terminal, Database, Cpu, HardDrive, Mail, ImageIcon, Plug } from 'lucide-react';
import Card from '../../components/common/Card.jsx';
import Badge from '../../components/common/Badge.jsx';
import Input from '../../components/common/Input.jsx';
import Select from '../../components/common/Select.jsx';
import Button from '../../components/common/Button.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import { Skeleton } from '../../components/common/Loader.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { adminApi } from '../../services/adminApi.js';
import { formatDateTime } from '../../utils/formatters.js';

const PAGE_SIZE = 50;
const LEVEL_TONE = { warn: 'warning', error: 'danger', fatal: 'danger' };

function Row({ icon: Icon, label, ok, children }) {
  return (
    <li className="iv-status-row">
      <Icon size={15} aria-hidden="true" />
      <span>
        <strong>{label}</strong> <Badge tone={ok ? 'ok' : 'warning'}>{ok ? 'OK' : 'Check'}</Badge> <span className="iv-muted">{children}</span>
      </span>
    </li>
  );
}

function SystemCard() {
  const { data, loading, error, reload } = useApiResource((signal) => adminApi.system({ signal }));
  const system = data?.system;
  return (
    <Card title={<span className="iv-gradient-text">Running system</span>} subtitle="This API process and the job queue, read live.">
      {loading && !system ? (
        <Skeleton height={140} />
      ) : error ? (
        <ErrorState plain title="Could not read the system" error={error} onRetry={reload} />
      ) : (
        <ul className="iv-list-reset d-flex flex-column gap-2">
          <Row icon={Database} label="Database" ok={system.database.connected}>
            {system.database.connected ? `connected to "${system.database.name}"` : 'not connected'}
          </Row>
          <Row icon={Cpu} label="Worker" ok={system.worker.enabledInThisProcess && system.worker.oldestDueSeconds < 300}>
            {system.worker.enabledInThisProcess ? 'running in this process' : 'off in this process'} · {system.worker.dueNow} job(s) due · oldest waiting{' '}
            {system.worker.oldestDueSeconds}s · {system.worker.workerConcurrency} per process, {system.worker.userConcurrency} per user
          </Row>
          <Row icon={ImageIcon} label="Infographics" ok>
            {system.worker.infographicsActive} generating or saving
          </Row>
          <Row icon={HardDrive} label="Storage" ok>
            {system.storage.driver}
            {system.storage.sharedBucketPrefix ? ` (shared bucket, confined to ${system.storage.sharedBucketPrefix})` : ''}
          </Row>
          <Row icon={Mail} label="Email" ok={system.email.deliversToInbox}>
            {system.email.provider}
            {system.email.deliversToInbox ? '' : ' (not delivering to inboxes)'}
          </Row>
          <Row icon={Plug} label="AI apps (MCP)" ok={system.mcp.enabled}>
            {system.mcp.enabled ? system.mcp.url : 'off'}
          </Row>
          <Row icon={Terminal} label="Process" ok>
            up {Math.round(system.process.uptimeSeconds / 60)} min · Node {system.process.node} · {system.process.memoryMb} MB
          </Row>
        </ul>
      )}
    </Card>
  );
}

/** Warnings and errors written by the server (kept 14 days), redacted twice before they are stored. */
export default function Operations() {
  const [level, setLevel] = useState('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [level, debounced]);

  const { data, loading, error, reload } = useApiResource(
    (signal) => adminApi.opsLogs({ level, search: debounced || undefined, page, limit: PAGE_SIZE }, { signal }),
    [level, debounced, page],
  );
  const items = data?.items || [];
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / PAGE_SIZE));

  return (
    <div className="d-flex flex-column gap-4">
      <SystemCard />
      <Card
        title={<span className="iv-gradient-text">Operations log</span>}
        subtitle="Server warnings and errors from the last 14 days. Client errors (4xx) are not kept; secrets are removed before storage."
      >
        <div className="iv-filters">
          <Input icon={Search} placeholder="Search messages..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search the log" />
          <div className="iv-field iv-field--fixed">
            <Select
              aria-label="Level"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              options={[
                { value: 'all', label: 'All levels' },
                { value: 'warn', label: 'Warnings' },
                { value: 'error', label: 'Errors' },
                { value: 'fatal', label: 'Fatal' },
              ]}
            />
          </div>
        </div>
        {loading && !data ? (
          <Skeleton height={200} />
        ) : error ? (
          <ErrorState plain title="Could not load the log" error={error} onRetry={reload} />
        ) : items.length === 0 ? (
          <EmptyState plain icon={Terminal} title="Nothing logged" description="No warnings or errors match. Entries appear here as the server writes them." />
        ) : (
          <>
            <ul className="iv-list-reset iv-ops-log">
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" className="iv-ops-log__row" onClick={() => setOpen(open === item.id ? null : item.id)} aria-expanded={open === item.id}>
                    <Badge tone={LEVEL_TONE[item.level]}>{item.level}</Badge>
                    <span className="iv-ops-log__msg">{item.message || '(no message)'}</span>
                    <span className="iv-muted small text-nowrap">{formatDateTime(item.at)}</span>
                  </button>
                  {open === item.id && (
                    <pre className="iv-ops-log__context">{JSON.stringify({ instance: item.instance, ...(item.context || {}) }, null, 2)}</pre>
                  )}
                </li>
              ))}
            </ul>
            <div className="d-flex justify-content-between align-items-center mt-3">
              <span className="small iv-muted">{data.total} entr{data.total === 1 ? 'y' : 'ies'}</span>
              <div className="d-flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
