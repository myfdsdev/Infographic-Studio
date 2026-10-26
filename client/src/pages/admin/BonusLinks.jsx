import { useState } from 'react';
import { Gift, Copy, Plus, Users } from 'lucide-react';
import Card from '../../components/common/Card.jsx';
import Input from '../../components/common/Input.jsx';
import Button from '../../components/common/Button.jsx';
import Badge from '../../components/common/Badge.jsx';
import Switch from '../../components/common/Switch.jsx';
import Modal from '../../components/common/Modal.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import { Skeleton } from '../../components/common/Loader.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { useToast } from '../../hooks/useToast.js';
import { adminApi } from '../../services/adminApi.js';
import { errorMessage } from '../../services/api.js';
import { formatDateTime, formatRelative } from '../../utils/formatters.js';

const STATE = {
  active: { label: 'Active', tone: 'ok' },
  disabled: { label: 'Off', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'warning' },
  used_up: { label: 'Fully claimed', tone: 'warning' },
};

const EMPTY = { name: '', credits: '100', maxUses: '', expiresOn: '' };

/** A date input (YYYY-MM-DD) as the end of that day in the admin's time zone. */
function endOfDay(value) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function CreateLink({ onCreated }) {
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    const next = {};
    const credits = Number(form.credits);
    const maxUses = form.maxUses.trim() ? Number(form.maxUses) : null;
    const expiresAt = endOfDay(form.expiresOn);
    if (form.name.trim().length < 2) next.name = 'Give the link a name';
    if (!Number.isInteger(credits) || credits < 1) next.credits = 'Enter a whole number of credits';
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) next.maxUses = 'Leave empty for unlimited, or enter a whole number';
    if (expiresAt === undefined || (expiresAt && new Date(expiresAt) <= new Date())) next.expiresOn = 'Choose a date in the future';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const { link } = await adminApi.createBonusLink({ name: form.name.trim(), credits, maxUses, expiresAt });
      setForm(EMPTY);
      onCreated(link);
      toast.success('Bonus link created. Copy it from the list below.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={
        <span className="d-inline-flex align-items-center gap-2">
          <Gift size={16} aria-hidden="true" /> <span className="iv-gradient-text">New bonus link</span>
        </span>
      }
      subtitle="People who create a new account through the link get the credits once. Existing accounts get nothing."
    >
      <form className="d-flex flex-column gap-3" onSubmit={submit} noValidate>
        <div className="iv-form-grid iv-form-grid--2">
          <Input label="Name" placeholder="e.g. Launch week promo" value={form.name} onChange={set('name')} error={errors.name} maxLength={80} />
          <Input label="Credits per sign-up" type="number" min={1} value={form.credits} onChange={set('credits')} error={errors.credits} />
          <Input
            label="Max sign-ups"
            type="number"
            min={1}
            placeholder="Unlimited"
            value={form.maxUses}
            onChange={set('maxUses')}
            error={errors.maxUses}
            hint="Leave empty for no limit."
          />
          <Input label="Expires on" type="date" value={form.expiresOn} onChange={set('expiresOn')} error={errors.expiresOn} hint="Optional. Ends at the end of that day." />
        </div>
        <div>
          <Button type="submit" icon={Plus} loading={saving}>
            Create link
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Signups({ link, onClose }) {
  const resource = useApiResource((signal) => (link ? adminApi.getBonusLink(link.id, { signal }) : Promise.resolve(null)), [link?.id]);
  const signups = resource.data?.signups || [];
  return (
    <Modal open={Boolean(link)} onClose={onClose} title={link ? `Sign-ups: ${link.name}` : ''} size="lg">
      {resource.loading && !resource.data ? (
        <Skeleton height={160} />
      ) : resource.error ? (
        <ErrorState plain title="Could not load sign-ups" error={resource.error} onRetry={resource.reload} />
      ) : signups.length === 0 ? (
        <p className="iv-muted mb-0">Nobody has signed up through this link yet.</p>
      ) : (
        <div className="iv-table-wrap">
          <table className="iv-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Signed up</th>
                <th>Credits now</th>
              </tr>
            </thead>
            <tbody>
              {signups.map((user) => (
                <tr key={user.id}>
                  <td>
                    <span className="iv-table__primary">{user.name}</span>
                    <span className="iv-table__sub">{user.email}</span>
                  </td>
                  <td>{formatDateTime(user.createdAt)}</td>
                  <td>{user.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** Bonus sign-up links: create, copy, switch on/off and see who used them. */
export default function BonusLinks() {
  const { toast } = useToast();
  const resource = useApiResource((signal) => adminApi.listBonusLinks({ signal }));
  const links = resource.data?.links || [];
  const [viewing, setViewing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const replace = (link) => resource.setData({ links: links.map((item) => (item.id === link.id ? link : item)) });

  const toggle = async (link, enabled) => {
    setBusyId(link.id);
    try {
      replace((await adminApi.updateBonusLink(link.id, { enabled })).link);
      toast.success(enabled ? 'Link switched on.' : 'Link switched off. New sign-ups through it get no credits.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (link) => {
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success('Link copied.');
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.');
    }
  };

  const totals = links.reduce((sum, link) => ({ uses: sum.uses + link.uses, credits: sum.credits + link.creditsGranted }), { uses: 0, credits: 0 });

  return (
    <div className="d-flex flex-column gap-4">
      <CreateLink onCreated={(link) => resource.setData({ links: [link, ...links] })} />

      <Card
        title={<span className="iv-gradient-text">Bonus links</span>}
        subtitle={links.length ? `${totals.uses} sign-ups through links · ${totals.credits} credits given` : undefined}
      >
        {resource.loading && !resource.data ? (
          <Skeleton height={200} />
        ) : resource.error ? (
          <ErrorState plain title="Could not load bonus links" error={resource.error} onRetry={resource.reload} />
        ) : links.length === 0 ? (
          <p className="iv-muted mb-0">No bonus links yet. Create one above.</p>
        ) : (
          <div className="iv-table-wrap">
            <table className="iv-table">
              <thead>
                <tr>
                  <th>Link</th>
                  <th>Credits</th>
                  <th>Sign-ups</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>On</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {links.map((link) => {
                  const state = STATE[link.state] || STATE.active;
                  return (
                    <tr key={link.id}>
                      <td>
                        <span className="iv-table__primary">{link.name}</span>
                        <span className="iv-bonus-url">
                          <code title={link.url}>{link.url}</code>
                          <button type="button" className="btn btn-iv-ghost btn-sm btn-iv-icon" onClick={() => copy(link)} aria-label={`Copy link ${link.name}`}>
                            <Copy size={14} />
                          </button>
                        </span>
                      </td>
                      <td>{link.credits}</td>
                      <td>
                        {link.uses}
                        {link.maxUses ? ` / ${link.maxUses}` : ''}
                        <span className="iv-table__sub">{link.creditsGranted} credits given</span>
                        {link.lastUsedAt && <span className="iv-table__sub">last {formatRelative(link.lastUsedAt)}</span>}
                      </td>
                      <td>{link.expiresAt ? formatDateTime(link.expiresAt) : 'Never'}</td>
                      <td>
                        <Badge tone={state.tone}>{state.label}</Badge>
                      </td>
                      <td>
                        <Switch
                          ariaLabel={`${link.name} switched on`}
                          checked={link.enabled}
                          disabled={busyId === link.id}
                          onChange={(enabled) => toggle(link, enabled)}
                        />
                      </td>
                      <td>
                        <Button variant="secondary" size="sm" icon={Users} onClick={() => setViewing(link)}>
                          Sign-ups
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Signups link={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
