import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Menu, Settings, KeyRound, LogOut, Eye } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.js';
import { useBranding } from '../../hooks/useBranding.js';
import { useKeyStatus } from '../../hooks/useKeyStatus.js';
import { TOP_NAV, ADMIN_TOP_NAV, ROUTES } from '../../utils/constants.js';
import { displayNameOf, initialsOf } from '../../utils/formatters.js';
import Badge from '../common/Badge.jsx';
import BrandMark from './BrandMark.jsx';

const KEY_LABELS = {
  connected: { label: 'Kie.ai connected', tone: 'ok', title: 'Your own Kie.ai key is connected' },
  unverified: { label: 'Key not verified', tone: 'missing', title: 'Your key is saved but could not be checked yet. Test it in API Settings.' },
  missing: { label: 'Connect API key', tone: 'missing', title: 'Connect your Kie.ai key to generate' },
  invalid: { label: 'Key rejected', tone: 'bad', title: 'Kie.ai rejected your key. Replace it in API Settings.' },
};

/** Credits while they pay, otherwise the own key's status. */
function chipFor({ status, credits, nextSource }) {
  if (credits?.platformAvailable && nextSource === 'credits') {
    const left = credits.infographicsLeft;
    return {
      label: `${credits.credits} credits`,
      tone: 'ok',
      title: `${left} infographic${left === 1 ? '' : 's'} left on credits (${credits.creditsPerInfographic} each), then your own Kie.ai key`,
    };
  }
  if (credits?.platformAvailable && !nextSource) {
    return { label: 'Out of credits', tone: 'bad', title: 'Add your own Kie.ai key in API Settings to keep generating' };
  }
  return KEY_LABELS[status];
}

function KeyStatus() {
  const keyStatus = useKeyStatus();
  if (keyStatus.loading && !keyStatus.credits) return null;
  const entry = chipFor(keyStatus);
  return (
    <Link to={ROUTES.apiSettings} className={`iv-key-status iv-key-status--${entry.tone}`} title={entry.title} aria-label={entry.label}>
      <span className="iv-key-status__label">{entry.label}</span>
    </Link>
  );
}

function ProfileMenu() {
  const { user, isAdmin, isPreview, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const go = (to) => {
    setOpen(false);
    navigate(to);
  };

  const signOut = async () => {
    setOpen(false);
    await logout();
    navigate(ROUTES.login, { replace: true });
  };

  return (
    <div className="iv-account" ref={wrapRef}>
      <button type="button" className="iv-account__btn" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-label="Profile menu">
        <span className="iv-avatar" aria-hidden="true">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initialsOf(user.name || user.email)}
        </span>
      </button>
      {open && (
        <div className="iv-menu iv-menu--down-end" role="menu">
          <div className="iv-menu__header">
            <strong>{displayNameOf(user)}</strong>
            <span>{user.email}</span>
            {(isAdmin || isPreview) && (
              <div className="d-flex gap-1 flex-wrap mt-2">
                {isAdmin && <Badge tone="accent">Admin</Badge>}
                {isPreview && <Badge tone="warning">Preview</Badge>}
              </div>
            )}
          </div>
          <button type="button" className="iv-menu__item" role="menuitem" onClick={() => go(ROUTES.account)}>
            <Settings /> Account settings
          </button>
          <button type="button" className="iv-menu__item" role="menuitem" onClick={() => go(ROUTES.apiSettings)}>
            <KeyRound /> API settings
          </button>
          <div className="iv-menu__sep" />
          <button type="button" className="iv-menu__item iv-menu__item--danger" role="menuitem" onClick={signOut}>
            {isPreview ? <Eye /> : <LogOut />} {isPreview ? 'Exit preview mode' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Top header: brand, the main tabs (a drawer below 1024 px), key status and profile. */
export default function Topbar({ onOpenMenu, menuOpen }) {
  const { appName } = useBranding();
  const { isAdmin } = useAuth();
  const tabs = isAdmin ? [...TOP_NAV, ADMIN_TOP_NAV] : TOP_NAV;

  return (
    <header className="iv-topbar">
      <button
        type="button"
        className="btn btn-iv-ghost btn-iv-icon iv-topbar__burger"
        onClick={onOpenMenu}
        aria-label="Open menu"
        aria-expanded={menuOpen}
        aria-controls="app-sidebar"
      >
        <Menu size={20} />
      </button>

      <Link to={ROUTES.dashboard} className="iv-topbar__brand" aria-label={`${appName} home`}>
        <BrandMark base="iv-topbar" />
      </Link>

      <nav className="iv-topnav" aria-label="Main navigation">
        {tabs.map((tab) => (
          <NavLink key={tab.key} to={tab.to} end={tab.end} className={({ isActive }) => `iv-topnav__link ${isActive ? 'is-active' : ''}`}>
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="iv-topbar__right">
        <KeyStatus />
        <ProfileMenu />
      </div>
    </header>
  );
}
