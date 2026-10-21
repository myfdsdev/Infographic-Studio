import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Search, Download, Users as UsersIcon } from 'lucide-react';
import Card from '../../components/common/Card.jsx';
import Input from '../../components/common/Input.jsx';
import Select from '../../components/common/Select.jsx';
import Badge from '../../components/common/Badge.jsx';
import Button from '../../components/common/Button.jsx';
import IntegrationPending from '../../components/common/IntegrationPending.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import { Skeleton } from '../../components/common/Loader.jsx';
import UsersTable from '../../components/admin/UsersTable.jsx';
import UserActionDialog from '../../components/admin/UserActionDialog.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../hooks/useToast.js';
import { adminApi } from '../../services/adminApi.js';
import { errorMessage } from '../../services/api.js';

const PAGE_SIZE = 25;

function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export default function Users() {
  const { refreshKey, refreshAdmin, stats } = useOutletContext() || {};
  const { user: me } = useAuth();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [pendingAction, setPendingAction] = useState(null);
  const [exporting, setExporting] = useState(false);
  const debouncedSearch = useDebounced(search.trim());

  useEffect(() => setPage(1), [debouncedSearch, status, role]);

  const { data, loading, error, notImplemented, reload } = useApiResource(
    (signal) => adminApi.listUsers({ search: debouncedSearch || undefined, status, role, page, limit: PAGE_SIZE }, { signal }),
    [debouncedSearch, status, role, page, refreshKey, tick],
  );
  const items = data?.items || [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = [];
      for (let current = 1; current <= 100; current += 1) {
        const result = await adminApi.listUsers({ search: debouncedSearch || undefined, status, role, page: current, limit: 100 });
        all.push(...(result?.items || []));
        if (all.length >= (result?.total ?? 0) || !result?.items?.length) break;
      }
      const header = ['Name', 'Email', 'Role', 'Status', 'Joined', 'Last sign-in', 'Suspended reason'];
      const rows = all.map((u) => [u.name, u.email, u.role, u.status, u.createdAt, u.lastLoginAt || '', u.suspendedReason || '']);
      const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `infographic_studio_users_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${all.length} user${all.length === 1 ? '' : 's'} to CSV`);
    } catch (err) {
      toast.error(`Export failed: ${errorMessage(err)}`);
    } finally {
      setExporting(false);
    }
  };

  const afterAction = () => {
    setTick((value) => value + 1);
    refreshAdmin?.();
  };

  return (
    <div className="d-flex flex-column gap-4">
      <Card
        title={<span className="iv-gradient-text">User Management</span>}
        actions={
          <Button variant="secondary" size="sm" icon={Download} onClick={exportCsv} loading={exporting} disabled={notImplemented || Boolean(error)}>
            Export CSV
          </Button>
        }
      >
        <div className="iv-filters">
          <Input
            icon={Search}
            placeholder="Search users by name or email..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search users"
          />
          <div className="iv-field iv-field--fixed">
            <Select
              aria-label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'active', label: 'Active' },
                { value: 'suspended', label: 'Suspended' },
              ]}
            />
          </div>
          <div className="iv-field iv-field--fixed">
            <Select
              aria-label="Role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              options={[
                { value: 'all', label: 'All Roles' },
                { value: 'user', label: 'Users' },
                { value: 'admin', label: 'Admins' },
              ]}
            />
          </div>
        </div>
      </Card>

      <Card
        title={`Users (${loading && !data ? '...' : total})`}
        actions={typeof stats?.activeUsers === 'number' ? <Badge>{stats.activeUsers} Active</Badge> : null}
      >
        {loading && !data ? (
          <div className="d-flex flex-column gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} height={82} />
            ))}
          </div>
        ) : notImplemented ? (
          <IntegrationPending compact endpoint="GET /api/admin/users" title="User listing not connected yet" />
        ) : error ? (
          <ErrorState plain title="Could not load users" error={error} onRetry={reload} />
        ) : items.length === 0 ? (
          <EmptyState
            plain
            icon={UsersIcon}
            title={debouncedSearch || status !== 'all' || role !== 'all' ? 'No users found matching your filters.' : 'No users yet'}
          />
        ) : (
          <>
            <UsersTable users={items} currentUserId={me?.id} onAction={(action, user) => setPendingAction({ action, user })} />
            {totalPages > 1 && (
              <div className="iv-pagination">
                <Button variant="secondary" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>
                  Previous
                </Button>
                <div className="iv-pagination__info">
                  <span>
                    Showing {first} to {last} of {total} users
                  </span>
                  <strong>
                    Page {page} of {totalPages}
                  </strong>
                </div>
                <Button variant="secondary" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      <UserActionDialog
        action={pendingAction?.action}
        user={pendingAction?.user}
        onClose={() => setPendingAction(null)}
        onDone={afterAction}
      />
    </div>
  );
}
