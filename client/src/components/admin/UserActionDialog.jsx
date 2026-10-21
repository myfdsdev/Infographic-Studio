import { useEffect, useState } from 'react';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import Input from '../common/Input.jsx';
import { adminApi } from '../../services/adminApi.js';
import { errorMessage } from '../../services/api.js';
import { useToast } from '../../hooks/useToast.js';

const ACTIONS = {
  suspend: {
    title: 'Suspend this user?',
    message: 'They are signed out of every session immediately and cannot sign in, reset their password or use connected AI clients until reactivated.',
    confirm: 'Suspend user',
    danger: true,
    body: { status: 'suspended' },
    reasonLabel: 'Reason (shown to admins and kept in the audit log)',
    success: 'User suspended',
  },
  reactivate: {
    title: 'Reactivate this user?',
    message: 'They can sign in again. Sessions that were ended by the suspension stay ended.',
    confirm: 'Reactivate',
    body: { status: 'active' },
    reasonLabel: 'Note for the audit log (optional)',
    success: 'User reactivated',
  },
  promote: {
    title: 'Make this user an administrator?',
    message: 'Administrators can manage every account and all system settings. The change applies on their next request.',
    confirm: 'Make admin',
    body: { role: 'admin' },
    success: 'User is now an administrator',
  },
  demote: {
    title: 'Remove the administrator role?',
    message: 'They lose access to the admin panel on their next request.',
    confirm: 'Remove admin role',
    danger: true,
    body: { role: 'user' },
    success: 'Administrator role removed',
  },
};

/** Confirms and applies a role/status change for one user. */
export default function UserActionDialog({ action, user, onClose, onDone }) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const config = action ? ACTIONS[action] : null;

  useEffect(() => {
    setReason('');
  }, [action, user?.id]);

  const confirm = async () => {
    if (!config || !user) return;
    setBusy(true);
    try {
      const body = { ...config.body, ...(config.reasonLabel && reason.trim() ? { reason: reason.trim() } : {}) };
      const result = await adminApi.updateUser(user.id, body);
      toast.success(
        result?.sessionsRevoked ? `${config.success}. ${result.sessionsRevoked} session(s) signed out.` : config.success,
      );
      onDone?.(result?.user);
      onClose?.();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={Boolean(config && user)}
      title={config?.title}
      message={config ? `${user?.email}: ${config.message}` : ''}
      confirmLabel={config?.confirm}
      danger={config?.danger}
      loading={busy}
      onConfirm={confirm}
      onCancel={onClose}
    >
      {config?.reasonLabel && (
        <div className="mt-3">
          <Input
            label={config.reasonLabel}
            textarea
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      )}
    </ConfirmDialog>
  );
}
