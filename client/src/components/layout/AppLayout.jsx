import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Eye } from 'lucide-react';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import ActingAsBanner from './ActingAsBanner.jsx';
import Button from '../common/Button.jsx';
import ErrorBoundary from '../common/ErrorBoundary.jsx';
import { KeyStatusProvider } from '../../context/KeyStatusContext.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { ROUTES } from '../../utils/constants.js';

/** Application shell: top navigation (a drawer below 1024 px) and the page. */
export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { isPreview, disablePreview } = useAuth();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (event) => event.key === 'Escape' && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.classList.add('iv-no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('iv-no-scroll');
    };
  }, [drawerOpen]);

  const close = useCallback(() => setDrawerOpen(false), []);

  const exitPreview = () => {
    disablePreview();
    navigate(ROUTES.login, { replace: true });
  };

  return (
    <KeyStatusProvider>
      <div className={`iv-app ${drawerOpen ? 'is-drawer-open' : ''}`}>
        <Sidebar onClose={close} />
        <div className="iv-scrim" onClick={close} aria-hidden="true" />
        <div className="iv-shell">
          <Topbar onOpenMenu={() => setDrawerOpen(true)} menuOpen={drawerOpen} />
          <ActingAsBanner />
          {isPreview && (
            <div className="iv-banner" role="status">
              <Eye size={16} aria-hidden="true" />
              <span>
                <strong>UI preview mode.</strong> You are not signed in and no data is loaded. Screens show their real empty and
                &quot;not connected&quot; states.
              </span>
              <Button variant="secondary" size="sm" onClick={exitPreview}>
                Exit preview
              </Button>
            </div>
          )}
          <main className={`iv-main ${location.pathname === '/' ? 'iv-main--studio' : ''}`}>
            <ErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </KeyStatusProvider>
  );
}
