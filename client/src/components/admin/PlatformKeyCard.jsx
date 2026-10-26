import { useState } from 'react';
import { KeyRound, ShieldCheck, RefreshCw, Trash2, Save } from 'lucide-react';
import Card from '../common/Card.jsx';
import Input from '../common/Input.jsx';
import Button from '../common/Button.jsx';
import Badge from '../common/Badge.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import ErrorState from '../common/ErrorState.jsx';
import { Skeleton } from '../common/Loader.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { useToast } from '../../hooks/useToast.js';
import { adminApi } from '../../services/adminApi.js';
import { errorMessage } from '../../services/api.js';
import { formatDateTime, formatRelative } from '../../utils/formatters.js';

const STATUS = {
  valid: { label: 'Working', tone: 'ok' },
  unverified: { label: 'Not verified yet', tone: 'warning' },
  invalid: { label: 'Rejected by Kie.ai', tone: 'danger' },
};

/**
 * The platform's own Kie.ai key: it runs every infographic paid with credits.
 * Saved encrypted; only its last 4 characters ever come back.
 */
export default function PlatformKeyCard() {
  const { toast } = useToast();
  const resource = useApiResource((signal) => adminApi.getPlatformKey({ signal }));
  const key = resource.data?.key;
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const run = async (kind, action, success) => {
    setBusy(kind);
    try {
      const result = await action();
      if (result?.key) resource.setData({ key: result.key });
      if (result?.verification && !result.verification.ok) toast.error(result.verification.error || 'Kie.ai could not check the key.');
      else toast.success(success);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    const ok = await run('save', () => adminApi.savePlatformKey(value.trim()), 'Platform key saved. Credit-paid generation uses it now.');
    if (ok) {
      setValue('');
      setEditing(false);
    }
  };

  let body;
  if (resource.loading && !key) body = <Skeleton height={120} />;
  else if (resource.error) body = <ErrorState plain title="Could not load the platform key" error={resource.error} onRetry={resource.reload} />;
  else if (key?.configured && !editing) {
    const status = STATUS[key.status] || STATUS.unverified;
    body = (
      <div className="d-flex flex-column gap-3">
        <dl className="iv-kv mb-0">
          <div className="iv-kv__row">
            <dt>Key</dt>
            <dd className="iv-mono">
              •••• •••• {key.last4} <Badge tone={status.tone}>{status.label}</Badge>
            </dd>
          </div>
          <div className="iv-kv__row">
            <dt>Kie.ai balance</dt>
            <dd>
              {key.balance ?? '-'} {key.lastVerifiedAt && <span className="iv-muted small">· checked {formatRelative(key.lastVerifiedAt)}</span>}
            </dd>
          </div>
          {key.lastCheckError && (
            <div className="iv-kv__row">
              <dt>Last problem</dt>
              <dd className="text-danger small">{key.lastCheckError}</dd>
            </div>
          )}
          <div className="iv-kv__row">
            <dt>Saved</dt>
            <dd className="small">
              {key.updatedAt ? formatDateTime(key.updatedAt) : '-'} {key.updatedBy && <span className="iv-muted">by {key.updatedBy}</span>}
            </dd>
          </div>
        </dl>
        <div className="d-flex gap-2 flex-wrap">
          <Button variant="secondary" size="sm" icon={RefreshCw} loading={busy === 'test'} onClick={() => run('test', adminApi.testPlatformKey, 'The platform key works.')}>
            Test connection
          </Button>
          <Button variant="secondary" size="sm" icon={KeyRound} onClick={() => setEditing(true)}>
            Replace key
          </Button>
          <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmRemove(true)}>
            Remove
          </Button>
        </div>
      </div>
    );
  } else {
    body = (
      <form className="d-flex flex-column gap-3" onSubmit={save} noValidate>
        {!key?.configured && (
          <p className="iv-muted small mb-0">
            No platform key yet: credits cannot be used and every user generates on their own key. Paste the Kie.ai key that should pay for
            credit-paid infographics.
          </p>
        )}
        <Input
          label="Platform Kie.ai API key"
          type="password"
          autoComplete="off"
          mono
          value={value}
          onChange={(event) => setValue(event.target.value)}
          hint="Checked with a free balance call, then encrypted. It is never shown again."
        />
        <div className="d-flex gap-2">
          <Button type="submit" size="sm" icon={Save} loading={busy === 'save'} disabled={value.trim().length < 16}>
            Save key
          </Button>
          {key?.configured && (
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    );
  }

  return (
    <Card
      title={
        <span className="d-inline-flex align-items-center gap-2">
          <ShieldCheck size={16} aria-hidden="true" /> <span className="iv-gradient-text">Platform Kie.ai key</span>
        </span>
      }
      subtitle="Pays for infographics bought with credits. Users' own keys are used only after their credits run out."
    >
      {body}
      <ConfirmDialog
        open={confirmRemove}
        title="Remove the platform key?"
        message="Credit-paid generation stops at once; users keep their credits and can still generate with their own keys. Tasks already at Kie.ai cannot be collected."
        confirmLabel="Remove key"
        danger
        loading={busy === 'remove'}
        onConfirm={async () => {
          const ok = await run('remove', adminApi.deletePlatformKey, 'Platform key removed.');
          if (ok) setConfirmRemove(false);
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </Card>
  );
}
