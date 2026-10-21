import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { X, ChevronsUpDown, Settings, KeyRound, LogOut, Eye } from 'lucide-react';
import { NAV_SECTIONS, ADMIN_NAV_SECTION, ROUTES } from '../../utils/constants.js';
import { useAuth } from '../../hooks/useAuth.js';
import BrandMark from './BrandMark.jsx';
import { useBranding } from '../../hooks/useBranding.js';
import { displayNameOf, initialsOf } from '../../utils/formatters.js';
import Badge from '../common/Badge.jsx';

function UserMenu() {
  const { user, isAdmin, isPreview, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const name = displayNameOf(user);

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
    <div className="iv-sidebar__user" ref={wrapRef}>
      <button type="button" className="iv-user-chip" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}>
        <span className="iv-avatar" aria-hidden="true">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initialsOf(user.name || user.email)}
        </span>
        <span className="iv-user-chip__text">
          <span className="iv-user-chip__name">{name}</span>
          <span className="iv-user-chip__email">{user.email}</span>
        </span>
        <ChevronsUpDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="iv-menu iv-menu--up" role="menu">
          {(isAdmin || isPreview) && (
            <div className="iv-menu__header">
              <div className="d-flex gap-1 flex-wrap">
                {isAdmin && <Badge tone="accent">Admin</Badge>}
                {isPreview && <Badge tone="warning">Preview</Badge>}
              </div>
            </div>
          )}
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

/** Left navigation: brand, grouped links, and the signed-in user at the bottom. */
export default function Sidebar({ onClose }) {
  const { appName } = useBranding();
  const { isAdmin } = useAuth();
  const sections = isAdmin ? [...NAV_SECTIONS, ADMIN_NAV_SECTION] : NAV_SECTIONS;

  return (
    <aside className="iv-sidebar" id="app-sidebar" aria-label="Main navigation">
      <div className="d-flex align-items-center">
        <Link to={ROUTES.dashboard} className="iv-sidebar__brand" aria-label={`${appName} home`}>
          <BrandMark base="iv-sidebar" />
        </Link>
        <button type="button" className="btn btn-iv-ghost btn-iv-icon btn-sm iv-sidebar__close me-3" onClick={onClose} aria-label="Close menu">
          <X size={18} />
        </button>
      </div>

      <nav className="iv-sidebar__nav">
        {sections.map((section) => (
          <div key={section.key} className="iv-sidebar__section">
            <div className="iv-sidebar__title">{section.title}</div>
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.key} to={item.to} end={item.end} className={({ isActive }) => `iv-navlink ${isActive ? 'is-active' : ''}`}>
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <UserMenu />
    </aside>
  );
}
