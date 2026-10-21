import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plug, Unplug } from 'lucide-react';
import Card from '../../components/common/Card.jsx';
import Badge from '../../components/common/Badge.jsx';
import Input from '../../components/common/Input.jsx';
import Select from '../../components/common/Select.jsx';
import Button from '../../components/common/Button.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import { Skeleton } from '../../components/common/Loader.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { useToast } from '../../hooks/useToast.js';
import { adminApi } from '../../services/adminApi.js';
import { errorMessage } from '../../services/api.js';
import { ROUTES } from '../../utils/constants.js';
import { formatDateTime } from '../../utils/formatters.js';

const REASONS = {
  user: 'by the user',
  admin: 'by an administrator',
  client: 'by the app',
  password_changed: 'password changed',
  password_reset: 'password reset',
  account_deleted: 'account deleted',
};

/** Every user's AI app connections (MCP). Revoking signs the app out at once. */
export default function Connections() {
  const { toast } = useToast();
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const list = useApiResource((signal) => adminApi.listConnections({ status, search: debounced || undefined, limit: 100 }, { signal }), [status, debounced]);
  const items = list.data?.items || [];

  const revoke = async () => {
    setBusy(true);
    try {
      const { connection } = await adminApi.revokeConnection(pending.id);
      list.setData((prev) => ({ ...prev, items: (prev?.items || []).map((item) => (item.id === connection.id ? { ...item, ...connection } : item)) }));
      toast.success('Connection revoked');
      setPending(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={<span className="iv-gradient-text">AI connections</span>}
      subtitle="AI apps users approved through the consent page. Users can revoke their own on the MCP Connection page."
    >
      <div className="iv-filters">
        <Input icon={Search} placeholder="Search by app name or user email..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search connections" />
        <div className="iv-field iv-field--fixed">
          <Select
            aria-label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'revoked', label: 'Revoked' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
      </div>
      {list.loading && !list.data ? (
        <Skeleton height={160} />
      ) : list.error ? (
        <ErrorState plain title="Could not load connections" error={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <EmptyState plain icon={Plug} title="No connections" description="Connections appear here when users approve an AI app." />
      ) : (
        <div className="table-responsive">
          <table className="iv-table">
            <thead>
              <tr>
                <th>App</th>
                <th>User</th>
                <th>Permissions</th>
                <th>Last used</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="d-block">{item.clientName}</span>
                    <span className="iv-table__sub">{item.publishedBy ? `Published by ${item.publishedBy}` : 'Registered automatically'}</span>
                  </td>
                  <td className="small">{item.userEmail ? <Link to={ROUTES.adminUser(item.userId)}>{item.userEmail}</Link> : '-'}</td>
                  <td className="small">{item.scopes.map((scope) => scope.id).join(', ')}</td>
                  <td className="small text-nowrap">
                    {item.lastUsedAt ? formatDateTime(item.lastUsedAt) : 'never'}
                    {item.lastTool ? <span className="iv-table__sub iv-mono">{item.lastTool}</span> : null}
                  </td>
                  <td>
                    {item.status === 'active' ? (
                      <Badge tone="ok">Active</Badge>
                    ) : (
                      <Badge>Revoked {REASONS[item.revokedReason] || ''}</Badge>
                    )}
                  </td>
                  <td className="text-end">
                    {item.status === 'active' && (
                      <Button variant="danger" size="sm" icon={Unplug} onClick={() => setPending(item)}>
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(pending)}
        title="Revoke this AI connection?"
        message={`${pending?.clientName} loses access to ${pending?.userEmail}'s account at once. The user can approve it again later. Generations it already started keep running.`}
        confirmLabel="Revoke"
        danger
        loading={busy}
        onConfirm={revoke}
        onCancel={() => setPending(null)}
      />
    </Card>
  );
}
