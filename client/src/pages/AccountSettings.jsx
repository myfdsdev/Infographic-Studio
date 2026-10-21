import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Save, KeyRound, LogOut, Trash2, Eye, EyeOff, Monitor, X } from 'lucide-react';
import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Input from '../components/common/Input.jsx';
import Button from '../components/common/Button.jsx';
import Badge from '../components/common/Badge.jsx';
import ConfirmDialog from '../components/common/ConfirmDialog.jsx';
import ErrorState from '../components/common/ErrorState.jsx';
import IntegrationPending from '../components/common/IntegrationPending.jsx';
import { Skeleton } from '../components/common/Loader.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from '../hooks/useToast.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { settingsApi } from '../services/settingsApi.js';
import { errorMessage, isNotImplemented } from '../services/api.js';
import { validateName, validatePassword, validatePasswordMatch, validateForm } from '../utils/validators.js';
import { initialsOf, displayNameOf, formatDate, formatRelative } from '../utils/formatters.js';
import { ROUTES } from '../utils/constants.js';
import { GoogleButton, GoogleMark, GOOGLE_CONNECT_URL, googleMessage } from '../components/auth/GoogleSignIn.jsx';

function describeAgent(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export default function AccountSettings() {
  const { user, isPreview, isAdmin, updateUser, markSignedOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // How this account signs in (password and/or Google).
  const account = useApiResource((signal) => settingsApi.getAccount({ signal }), [], { enabled: !isPreview });
  const signIn = account.data?.signIn || null;
  const hasPassword = signIn ? signIn.hasPassword : true;
  const [disconnecting, setDisconnecting] = useState(false);

  // Coming back from Google (connect flow): show the result once, then tidy the URL.
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('google');
    if (!code) return;
    if (code === 'connected') toast.success(googleMessage(code));
    else toast.error(googleMessage(code));
    navigate(location.pathname, { replace: true });
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const [profile, setProfile] = useState({ name: user?.name || '' });
  const [profileErrors, setProfileErrors] = useState({});
  const [savingProfile, setSavingProfile] = useState(false);

  const [password, setPassword] = useState({ current: '', next: '', confirm: '' });
  const [passwordErrors, setPasswordErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const sessions = useApiResource((signal) => settingsApi.listSessions({ signal }), [], { enabled: !isPreview });
  const [revokingId, setRevokingId] = useState(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deleting, setDeleting] = useState(false);

  const notify = (err) => toast[isNotImplemented(err) ? 'info' : 'error'](errorMessage(err));

  const saveProfile = async (event) => {
    event.preventDefault();
    const { errors, valid } = validateForm(profile, { name: validateName });
    setProfileErrors(errors);
    if (!valid) return;
    setSavingProfile(true);
    try {
      const result = await settingsApi.updateAccount({ name: profile.name.trim() });
      updateUser(result?.user || { name: profile.name.trim() });
      toast.success('Profile updated');
    } catch (err) {
      notify(err);
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    const { errors, valid } = validateForm(password, {
      current: (value) => (value || !hasPassword ? null : 'Enter your current password'),
      next: validatePassword,
      confirm: (value, all) => validatePasswordMatch(all.next, value),
    });
    setPasswordErrors(errors);
    if (!valid) return;
    setSavingPassword(true);
    try {
      const result = await settingsApi.changePassword({
        currentPassword: hasPassword ? password.current : undefined,
        newPassword: password.next,
      });
      setPassword({ current: '', next: '', confirm: '' });
      if (!hasPassword) {
        toast.success('Password set. You can now also sign in with your email and password.');
        account.reload();
        sessions.reload();
        return;
      }
      const others = result?.otherSessionsRevoked || 0;
      const apps = result?.aiConnectionsRevoked || 0;
      const parts = [others ? `${others} other session(s) signed out` : '', apps ? `${apps} AI app connection(s) revoked` : ''].filter(Boolean);
      toast.success(parts.length ? `Password changed. ${parts.join('; ')}.` : 'Password changed');
      sessions.reload();
    } catch (err) {
      if (err?.code === 'CURRENT_PASSWORD_INVALID') setPasswordErrors({ current: err.message });
      notify(err);
    } finally {
      setSavingPassword(false);
    }
  };

  const revokeOne = async (session) => {
    setRevokingId(session.id);
    try {
      await settingsApi.revokeSession(session.id);
      sessions.setData((prev) => ({ ...(prev || {}), items: (prev?.items || []).filter((s) => s.id !== session.id) }));
      toast.success('Session signed out');
    } catch (err) {
      notify(err);
    } finally {
      setRevokingId(null);
    }
  };

  const revokeOthers = async () => {
    setRevokingOthers(true);
    try {
      const result = await settingsApi.revokeOtherSessions();
      toast.success(result?.revoked ? `${result.revoked} other session(s) signed out` : 'No other sessions were active');
      sessions.reload();
    } catch (err) {
      notify(err);
    } finally {
      setRevokingOthers(false);
    }
  };

  const disconnectGoogle = async () => {
    setDisconnecting(true);
    try {
      const result = await settingsApi.disconnectGoogle();
      account.setData((prev) => ({ ...(prev || {}), signIn: result?.signIn || prev?.signIn }));
      toast.success('Google disconnected. Sign in with your email and password from now on.');
    } catch (err) {
      notify(err);
    } finally {
      setDisconnecting(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await settingsApi.deleteAccount(hasPassword ? { password: deletePassword } : { confirmEmail: deleteEmail });
      toast.success('Your account was deleted');
      markSignedOut();
      navigate(ROUTES.login, { replace: true });
    } catch (err) {
      notify(err);
      setDeleting(false);
    }
  };

  const sessionItems = sessions.data?.items || [];

  return (
    <div className="iv-page">
      <div className="iv-container--medium mx-auto d-flex flex-column gap-3">
        <PageHeader title="Account settings" description="Your profile, password and signed-in devices." />

        <Card title="Profile">
          <div className="d-flex align-items-center gap-3 mb-3">
            <span className="iv-avatar iv-avatar--lg" aria-hidden="true">
              {initialsOf(user?.name || user?.email)}
            </span>
            <div className="min-w-0">
              <strong className="d-block">{displayNameOf(user)}</strong>
              <span className="small iv-muted d-block iv-truncate">{user?.email}</span>
              <div className="d-flex gap-1 mt-1 flex-wrap">
                {isAdmin && <Badge tone="accent">Admin</Badge>}
                {isPreview && <Badge tone="warning">Preview mode</Badge>}
                {user?.createdAt && <Badge>Member since {formatDate(user.createdAt)}</Badge>}
              </div>
            </div>
          </div>
          <form onSubmit={saveProfile} className="d-flex flex-column gap-3" noValidate>
            <div className="iv-form-grid iv-form-grid--2">
              <Input
                label="Display name"
                value={profile.name}
                onChange={(event) => setProfile({ name: event.target.value })}
                error={profileErrors.name}
                maxLength={80}
                required
              />
              <Input label="Email" value={user?.email || ''} readOnly disabled hint="Email changes are not available yet." />
            </div>
            <div className="d-flex justify-content-end">
              <Button type="submit" icon={Save} loading={savingProfile}>
                Save profile
              </Button>
            </div>
          </form>
        </Card>

        {!isPreview && signIn && (
          <Card title="Sign-in methods" subtitle="The ways you can sign in to this account.">
            <ul className="iv-signin-methods">
              <li>
                <KeyRound size={18} aria-hidden="true" />
                <span className="iv-signin-methods__body">
                  <strong>Email and password</strong>
                  <span className="small iv-muted">
                    {hasPassword ? 'Set' : 'No password yet. Set one below to sign in with your email too.'}
                  </span>
                </span>
                {hasPassword ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}
              </li>
              <li>
                <GoogleMark size={18} />
                <span className="iv-signin-methods__body">
                  <strong>Google</strong>
                  <span className="small iv-muted iv-truncate">
                    {signIn.google.connected
                      ? `Connected as ${signIn.google.email}`
                      : signIn.google.available
                        ? 'Not connected'
                        : 'Not set up on this server'}
                  </span>
                </span>
                {signIn.google.connected ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={disconnectGoogle}
                    loading={disconnecting}
                    disabled={!hasPassword}
                    title={hasPassword ? undefined : 'Set a password first, so you can still sign in.'}
                  >
                    Disconnect
                  </Button>
                ) : (
                  signIn.google.available && (
                    <GoogleButton href={GOOGLE_CONNECT_URL} className="btn-sm">
                      Connect Google
                    </GoogleButton>
                  )
                )}
              </li>
            </ul>
            {signIn.google.connected && !hasPassword && (
              <p className="iv-field__hint mt-2 mb-0">To disconnect Google, set a password first so you can still sign in.</p>
            )}
          </Card>
        )}

        <Card
          title={hasPassword ? 'Password' : 'Set a password'}
          subtitle={
            hasPassword
              ? 'Changing your password signs out every other device.'
              : 'Your account signs in with Google. Add a password to also sign in with your email.'
          }
        >
          <form onSubmit={changePassword} className="d-flex flex-column gap-3" noValidate>
            {hasPassword && (
              <Input
                label="Current password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password.current}
                onChange={(event) => setPassword((prev) => ({ ...prev, current: event.target.value }))}
                error={passwordErrors.current}
                right={
                  <button type="button" className="btn btn-iv-ghost btn-sm btn-iv-icon" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}>
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                }
              />
            )}
            <div className="iv-form-grid iv-form-grid--2">
              <Input
                label="New password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password.next}
                onChange={(event) => setPassword((prev) => ({ ...prev, next: event.target.value }))}
                error={passwordErrors.next}
                hint="At least 8 characters with letters and numbers."
              />
              <Input
                label="Confirm new password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password.confirm}
                onChange={(event) => setPassword((prev) => ({ ...prev, confirm: event.target.value }))}
                error={passwordErrors.confirm}
              />
            </div>
            <div className="d-flex justify-content-end">
              <Button type="submit" icon={KeyRound} loading={savingPassword} variant="secondary">
                {hasPassword ? 'Change password' : 'Set password'}
              </Button>
            </div>
          </form>
        </Card>

        <Card
          title="Signed-in devices"
          subtitle="Every browser currently signed in to your account."
          actions={
            <Button variant="secondary" size="sm" icon={LogOut} onClick={revokeOthers} loading={revokingOthers} disabled={isPreview}>
              Sign out other sessions
            </Button>
          }
        >
          {isPreview ? (
            <p className="mb-0 small iv-muted">Not available in preview mode.</p>
          ) : sessions.loading && !sessions.data ? (
            <Skeleton height={90} />
          ) : sessions.notImplemented ? (
            <IntegrationPending compact endpoint="GET /api/settings/sessions" />
          ) : sessions.error ? (
            <ErrorState plain title="Could not load sessions" error={sessions.error} onRetry={sessions.reload} />
          ) : (
            <ul className="iv-activity">
              {sessionItems.map((session) => (
                <li key={session.id} className="align-items-center">
                  <Monitor size={18} className="flex-shrink-0" aria-hidden="true" />
                  <span className="iv-activity__body">
                    <strong>{describeAgent(session.userAgent)}</strong>{' '}
                    {session.current && <Badge tone="accent">This device</Badge>}
                    <span className="iv-activity__summary">
                      Last active {formatRelative(session.lastSeenAt)}
                      {session.ip ? ` · ${session.ip}` : ''} · signed in {formatDate(session.createdAt)}
                    </span>
                  </span>
                  {!session.current && (
                    <Button variant="ghost" size="sm" icon={X} loading={revokingId === session.id} onClick={() => revokeOne(session)}>
                      Sign out
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Danger zone" subtitle="Deleting your account removes your profile and signs you out everywhere.">
          <Button variant="danger" icon={Trash2} onClick={() => setDeleteOpen(true)} disabled={isPreview}>
            Delete account
          </Button>
        </Card>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete your account?"
        message={
          hasPassword
            ? 'This permanently removes your account. Enter your password to confirm.'
            : 'This permanently removes your account. Type your account email to confirm.'
        }
        confirmLabel="Delete account"
        danger
        loading={deleting}
        onConfirm={deleteAccount}
        onCancel={() => {
          setDeleteOpen(false);
          setDeletePassword('');
          setDeleteEmail('');
        }}
      >
        <div className="mt-3">
          {hasPassword ? (
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
              data-autofocus
            />
          ) : (
            <Input
              label="Account email"
              type="email"
              autoComplete="off"
              placeholder={user?.email}
              value={deleteEmail}
              onChange={(event) => setDeleteEmail(event.target.value)}
              data-autofocus
            />
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}
