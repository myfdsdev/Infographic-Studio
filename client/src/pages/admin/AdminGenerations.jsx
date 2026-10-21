import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Images, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import Card from '../../components/common/Card.jsx';
import Input from '../../components/common/Input.jsx';
import Select from '../../components/common/Select.jsx';
import Button from '../../components/common/Button.jsx';
import { StatusBadge } from '../../components/common/Badge.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import { Skeleton } from '../../components/common/Loader.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { adminApi } from '../../services/adminApi.js';
import { INFOGRAPHIC_STATUSES, INFOGRAPHIC_STYLES, ROUTES } from '../../utils/constants.js';
import { formatDateTime, formatRelative } from '../../utils/formatters.js';

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'In progress' },
  { value: 'completed', label: 'Ready' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const STYLE_LABEL = Object.fromEntries(INFOGRAPHIC_STYLES.map((s) => [s.value, s.label]));

/**
 * Every user's infographics. Shows the short title, never the full prompt;
 * provider errors are redacted on the server (no keys, tokens or signed URLs).
 */
export default function AdminGenerations() {
  const { refreshKey } = useOutletContext() || {};
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, loading, error, reload } = useApiResource(
    (signal) => adminApi.listInfographics({ status, search: search || undefined, page, limit: PAGE_SIZE }, { signal }),
    [status, search, page, refreshKey],
  );
  const items = data?.items || [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card title="Generation monitoring" subtitle="All infographics across users, newest first. Topics are shortened; prompts and keys are never shown.">
      <div className="iv-filters">
        <Input icon={Search} placeholder="Search by user email, title or id" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} aria-label="Search generations" />
        <div className="iv-field iv-field--fixed" style={{ minWidth: 180 }}>
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
          />
        </div>
      </div>

      {loading && !data ? (
        <Skeleton height={240} />
      ) : error ? (
        <ErrorState plain title="Could not load generations" error={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState plain icon={Images} title="No generations found" description={search || status !== 'all' ? 'Try another search or filter.' : 'Infographics appear here as users generate them.'} />
      ) : (
        <>
          <div className="iv-table-wrap">
            <table className="iv-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>User</th>
                  <th>Title</th>
                  <th>Style</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Provider error</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="text-nowrap" title={formatDateTime(item.createdAt)}>
                      {formatRelative(item.createdAt)}
                    </td>
                    <td>
                      <Link to={ROUTES.adminUser(item.userId)} className="iv-table__primary">
                        {item.userEmail || item.userId}
                      </Link>
                    </td>
                    <td style={{ maxWidth: 280 }}>
                      <div className="iv-truncate" title={item.title}>
                        {item.title}
                      </div>
                      <div className="iv-table__sub iv-mono">{item.id}</div>
                    </td>
                    <td className="text-nowrap">
                      {STYLE_LABEL[item.style] || item.style} · {item.aspectRatio}
                    </td>
                    <td>{item.source === 'mcp' ? 'MCP' : 'Web'}</td>
                    <td>
                      <StatusBadge status={item.status} map={INFOGRAPHIC_STATUSES} />
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      {item.error ? (
                        <>
                          <div className="iv-mono small">{item.error.code}</div>
                          <div className="iv-table__sub">{item.error.message}</div>
                        </>
                      ) : (
                        <span className="iv-dim">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="iv-pagination">
            <span className="iv-pagination__info">
              {total} generation{total === 1 ? '' : 's'} · page {page} of {pages}
            </span>
            <div className="d-flex gap-2">
              <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" size="sm" iconRight={ChevronRight} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
