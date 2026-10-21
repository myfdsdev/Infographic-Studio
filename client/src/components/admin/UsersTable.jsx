import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Eye, UserX, UserCheck, ShieldPlus, ShieldMinus } from 'lucide-react';
import Badge from '../common/Badge.jsx';
import { ROUTES } from '../../utils/constants.js';
import { formatDate, formatRelative, initialsOf, displayNameOf } from '../../utils/formatters.js';

const STATUS_TONE = { active: 'ok', suspended: 'danger' };

function RowMenu({ user, isSelf, onAction }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();

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

  const run = (action) => {
    setOpen(false);
    onAction?.(action, user);
  };

  return (
    <div className="iv-account" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-iv-ghost btn-iv-icon"
        aria-label={`Actions for ${user.email}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="iv-menu iv-menu--down-end" role="menu">
          <button type="button" className="iv-menu__item" role="menuitem" onClick={() => navigate(ROUTES.adminUser(user.id))}>
            <Eye /> View details
          </button>
          {!isSelf && (
            <>
              <div className="iv-menu__sep" />
              {user.role === 'admin' ? (
                <button type="button" className="iv-menu__item" role="menuitem" onClick={() => run('demote')}>
                  <ShieldMinus /> Remove admin role
                </button>
              ) : (
                <button type="button" className="iv-menu__item" role="menuitem" onClick={() => run('promote')}>
                  <ShieldPlus /> Make admin
                </button>
              )}
              {user.status === 'suspended' ? (
                <button type="button" className="iv-menu__item" role="menuitem" onClick={() => run('reactivate')}>
                  <UserCheck /> Reactivate
                </button>
              ) : (
                <button type="button" className="iv-menu__item iv-menu__item--danger" role="menuitem" onClick={() => run('suspend')}>
                  <UserX /> Suspend
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** User rows in the reference panel's style: avatar, identity, badges, meta, actions. */
export default function UsersTable({ users = [], currentUserId, onAction }) {
  return (
    <div className="iv-user-list">
      {users.map((user, index) => (
        <div key={user.id} className="iv-user-row" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
          <div className="iv-user-row__main">
            <span className="iv-avatar iv-avatar--md" aria-hidden="true">
              {initialsOf(user.name || user.email)}
            </span>
            <div className="min-w-0">
              <h4 className="iv-user-row__name">
                {displayNameOf(user)}
                {user.id === currentUserId && <span className="iv-muted fw-normal"> (you)</span>}
              </h4>
              <p className="iv-user-row__email">{user.email}</p>
              <div className="iv-user-row__badges">
                <Badge tone={STATUS_TONE[user.status] || 'neutral'}>{user.status}</Badge>
                {user.role === 'admin' ? <Badge tone="accent">Admin</Badge> : <Badge>User</Badge>}
                {user.suspendedReason && <Badge tone="danger">Reason: {user.suspendedReason}</Badge>}
              </div>
            </div>
          </div>
          <div className="iv-user-row__right">
            <div className="iv-user-row__meta">
              <strong>{user.lastLoginAt ? `Active ${formatRelative(user.lastLoginAt)}` : 'Never signed in'}</strong>
              <span>Joined {formatDate(user.createdAt)}</span>
            </div>
            <RowMenu user={user} isSelf={user.id === currentUserId} onAction={onAction} />
          </div>
        </div>
      ))}
    </div>
  );
}
