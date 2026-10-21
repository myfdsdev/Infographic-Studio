import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ScrollText, Search } from 'lucide-react';
import Card from '../../components/common/Card.jsx';
import Input from '../../components/common/Input.jsx';
import Select from '../../components/common/Select.jsx';
import Button from '../../components/common/Button.jsx';
import Badge from '../../components/common/Badge.jsx';
import Modal from '../../components/common/Modal.jsx';
import IntegrationPending from '../../components/common/IntegrationPending.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import Loader from '../../components/common/Loader.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { adminApi } from '../../services/adminApi.js';
import { formatDateTime, titleCase } from '../../utils/formatters.js';

const PAGE_SIZE = 50;

const AREAS = [
  { value: 'all', label: 'All areas' },
  { value: 'auth', label: 'Authentication' },
  { value: 'account', label: 'Account' },
  { value: 'admin', label: 'Admin actions' },
  { value: 'mcp', label: 'AI connections (MCP)' },
  { value: 'system', label: 'System' },
];

const OUTCOMES = [
  { value: 'all', label: 'All outcomes' },
  { value: 'success', label: 'Success' },
  { value: 'failure', label: 'Failure' },
];

export default function AuditLogs() {
  const { refreshKey } = useOutletContext() || {};
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [area, setArea] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [debounced, area, outcome]);

  const { data, loading, error, notImplemented, reload } = useApiResource(
    (signal) => adminApi.listAuditLogs({ search: debounced || undefined, area, outcome, page, limit: PAGE_SIZE }, { signal }),
    [debounced, area, outcome, page, refreshKey],
  );
  const items = data?.items || [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Card
        title={
          <span className="d-inline-flex align-items-center gap-2">
            <ScrollText size={20} aria-hidden="true" /> Audit Logs
          </span>
        }
        subtitle="Sign-ins, password resets, account changes and admin actions. Secrets are never recorded."
      >
        <div className="iv-filters mb-3">
          <Input icon={Search} placeholder="Search action, email or summary..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search audit logs" />
          <div className="iv-field iv-field--fixed">
            <Select aria-label="Area" value={area} onChange={(event) => setArea(event.target.value)} options={AREAS} />
          </div>
          <div className="iv-field iv-field--fixed">
            <Select aria-label="Outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} options={OUTCOMES} />
          </div>
        </div>

        {notImplemented ? (
          <IntegrationPending compact endpoint="GET /api/admin/audit-logs" title="Audit log not connected yet" />
        ) : error ? (
          <ErrorState plain title="Could not load audit logs" error={error} onRetry={reload} />
        ) : (
          <div className="iv-table-wrap">
            <table className="iv-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Outcome</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  <tr>
                    <td colSpan={6}>
                      <Loader label="Loading audit logs" />
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-5 iv-muted">
                      No audit entries found.
                    </td>
                  </tr>
                ) : (
                  items.map((entry) => (
                    <tr key={entry.id}>
                      <td className="text-nowrap">{formatDateTime(entry.createdAt)}</td>
                      <td>
                        <Badge tone={entry.outcome === 'failure' ? 'danger' : 'ok'}>{entry.outcome}</Badge>
                      </td>
                      <td>
                        <span className="iv-table__primary">{titleCase(entry.action.replace(/\./g, ' '))}</span>
                        <span className="iv-table__sub">{titleCase(entry.area)}</span>
                      </td>
                      <td>{entry.actorEmail || <span className="iv-dim">anonymous</span>}</td>
                      <td>{entry.targetEmail || (entry.targetType ? `${titleCase(entry.targetType)} ${entry.targetId?.slice(-6) || ''}` : '-')}</td>
                      <td>
                        <Button variant="secondary" size="sm" onClick={() => setSelected(entry)}>
                          Details
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {!notImplemented && !error && totalPages > 1 && (
          <div className="iv-pagination">
            <Button variant="secondary" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>
              Previous
            </Button>
            <div className="iv-pagination__info">
              <span>{total} entries</span>
              <strong>
                Page {page} of {totalPages}
              </strong>
            </div>
            <Button variant="secondary" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>
              Next
            </Button>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        size="lg"
        title={selected ? titleCase(selected.action.replace(/\./g, ' ')) : ''}
        description={selected ? `${formatDateTime(selected.createdAt)} · ${selected.outcome}` : ''}
      >
        {selected && (
          <div className="d-flex flex-column gap-3">
            <dl className="iv-kv">
              {[
                ['Actor', selected.actorEmail || 'anonymous'],
                ['Actor role', selected.actorRole || '-'],
                ['Target', selected.targetEmail || selected.targetId || '-'],
                ['Summary', selected.summary || '-'],
                ['IP address', selected.ip || '-'],
              ].map(([label, value]) => (
                <div key={label} className="iv-kv__row">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <pre className="iv-pre">{JSON.stringify(selected.metadata || {}, null, 2)}</pre>
          </div>
        )}
      </Modal>
    </>
  );
}
