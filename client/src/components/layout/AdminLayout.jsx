import { useCallback, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Button from '../common/Button.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { adminApi } from '../../services/adminApi.js';
import { ADMIN_TABS } from '../../utils/constants.js';

/**
 * Admin shell: title with a refresh button, one horizontal section bar, and
 * the active section. Every admin API call is authorised on the server; this
 * layout is only reachable through AdminRoute as a convenience.
 */
export default function AdminLayout() {
  const [refreshKey, setRefreshKey] = useState(0);
  const stats = useApiResource((signal) => adminApi.stats({ signal }), [refreshKey]);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  return (
    <div className="iv-container iv-admin">
      <header className="iv-admin-header">
        <div>
          <h1 className="iv-admin-title">Admin Panel</h1>
          <p className="iv-admin-subtitle">Users, generations, MCP activity and platform settings.</p>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh} loading={stats.loading}>
          Refresh
        </Button>
      </header>

      <nav className="iv-admin-nav" aria-label="Admin sections">
        {ADMIN_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <NavLink key={tab.key} to={tab.to} className={({ isActive }) => `iv-admin-nav__link ${isActive ? 'is-active' : ''}`}>
              <Icon aria-hidden="true" />
              {tab.label}
            </NavLink>
          );
        })}
      </nav>

      {stats.error && (
        <div className="iv-alert iv-alert--danger" role="alert">
          Could not load admin statistics: {stats.error.message}
        </div>
      )}

      <Outlet context={{ refreshKey, refreshAdmin: refresh, stats: stats.data?.stats || {}, statsLoading: stats.loading }} />
    </div>
  );
}
