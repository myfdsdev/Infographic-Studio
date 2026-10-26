import { useState } from 'react';
import {
  KeyRound,
  Eye,
  EyeOff,
  ShieldCheck,
  Trash2,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Lock,
  PlugZap,
  Sparkles,
} from 'lucide-react';
import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Input from '../components/common/Input.jsx';
import Button from '../components/common/Button.jsx';
import { StatusBadge } from '../components/common/Badge.jsx';
import Badge from '../components/common/Badge.jsx';
import ConfirmDialog from '../components/common/ConfirmDialog.jsx';
import { Skeleton } from '../components/common/Loader.jsx';
import { useKeyStatus } from '../hooks/useKeyStatus.js';
import { useToast } from '../hooks/useToast.js';
import { useAuth } from '../hooks/useAuth.js';
import { useBranding } from '../hooks/useBranding.js';
import { settingsApi } from '../services/settingsApi.js';
import { errorMessage } from '../services/api.js';
import { validateApiKey } from '../utils/validators.js';
import { PROVIDER, CREDENTIAL_STATUSES, ROUTES } from '../utils/constants.js';
import { formatDateTime, formatRelative, maskKey } from '../utils/formatters.js';

function KeyForm({ replacing, onSaved, onCancel, disabled }) {
  const { toast } = useToast();
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    const message = validateApiKey(key);
    setError(message);
    if (message) return;
    setSaving(true);
    try {
      const result = await settingsApi.saveCredential(PROVIDER.key, { apiKey: key.trim() });
      setKey('');
      setShow(false);
      onSaved(result.credential);
      if (result.verification?.ok) toast.success(`${PROVIDER.name} key ${replacing ? 'replaced' : 'connected'} and verified`);
      else toast.info(`Key saved, but it could not be checked yet: ${result.verification?.error || 'unknown error'}`);
    } catch (err) {
      setError(err?.code === 'KEY_REJECTED' || err?.status === 400 ? err.message : null);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="d-flex flex-column gap-3" noValidate>
      <Input
        label={replacing ? 'New API key' : 'Your Kie.ai API key'}
        icon={KeyRound}
        type={show ? 'text' : 'password'}
        mono
        placeholder="Paste your Kie.ai API key"
        value={key}
        onChange={(event) => {
          setKey(event.target.value);
          if (error) setError(null);
        }}
        error={error}
        hint="It is checked against your Kie.ai credit balance (free), then encrypted. It is never shown again."
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        right={
          <button type="button" className="btn btn-iv-ghost btn-sm btn-iv-icon" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide key' : 'Show key'}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        }
      />
      <div className="d-flex flex-wrap gap-2 justify-content-end">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button type="submit" icon={ShieldCheck} loading={saving} disabled={!key.trim() || disabled}>
          {replacing ? 'Replace key' : 'Connect API Key'}
        </Button>
      </div>
    </form>
  );
}

function Connected({ credential, onReplace, onRemove, onTested }) {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const invalid = credential.status === 'invalid';
  const unverified = credential.status === 'unverified';

  const test = async () => {
    setTesting(true);
    try {
      const result = await settingsApi.verifyCredential(PROVIDER.key);
      onTested(result.credential);
      if (result.verification?.ok) {
        const balance = result.verification.balance;
        toast.success(`Connection works${balance != null ? ` · ${balance} credits available` : ''}`);
      } else {
        toast.error(`Check failed: ${result.verification?.error || 'unknown error'}`);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      <div className="iv-connected">
        <span className={`iv-connected__icon ${invalid ? 'iv-connected__icon--bad' : unverified ? 'iv-connected__icon--warn' : ''}`} aria-hidden="true">
          {invalid ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
        </span>
        <div className="iv-connected__text">
          <strong>{invalid ? 'Kie.ai rejected this key' : unverified ? 'Key saved, not verified yet' : 'Your key is connected'}</strong>
          <span className="iv-key-mask">{maskKey(credential.last4)}</span>
        </div>
        <div className="iv-connected__actions">
          <Button variant="secondary" size="sm" icon={PlugZap} onClick={test} loading={testing}>
            Test connection
          </Button>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onReplace}>
            Replace key
          </Button>
          <Button variant="danger" size="sm" icon={Trash2} onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>

      {invalid && credential.lastCheckError && (
        <div className="iv-alert iv-alert--danger" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>
            {credential.lastCheckError}. Generation is blocked until you replace the key.
          </span>
        </div>
      )}

      <dl className="iv-kv">
        <div className="iv-kv__row">
          <dt>Status</dt>
          <dd>
            <StatusBadge status={credential.status} map={CREDENTIAL_STATUSES} />
          </dd>
        </div>
        <div className="iv-kv__row">
          <dt>Last verified</dt>
          <dd>{credential.lastVerifiedAt ? formatDateTime(credential.lastVerifiedAt) : 'Never'}</dd>
        </div>
        {credential.balance !== null && credential.balance !== undefined && (
          <div className="iv-kv__row">
            <dt>Kie.ai balance</dt>
            <dd>
              {credential.balance} credits
              {credential.balanceCheckedAt && <span className="iv-muted"> · checked {formatRelative(credential.balanceCheckedAt)}</span>}
            </dd>
          </div>
        )}
        <div className="iv-kv__row">
          <dt>Connected</dt>
          <dd>{formatDateTime(credential.createdAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

const CREDIT_REASONS = {
  bonus_signup: 'Sign-up bonus',
  generation: 'Infographic',
  refund: 'Refund (generation failed)',
  admin_adjustment: 'Adjusted by support',
};

/** Platform credits: spent first, then the user's own key takes over. */
function CreditsCard({ credits }) {
  if (!credits || (!credits.platformAvailable && !credits.credits)) return null;
  const cost = credits.creditsPerInfographic;
  return (
    <section className="iv-card">
      <div className="iv-card__body d-flex flex-column gap-3">
        <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
          <div>
            <h2 className="h6 mb-2">Your credits</h2>
            <div className="iv-credits">
              <span className="iv-credits__value">{credits.credits}</span>
              <span className="iv-credits__unit">
                credits · {credits.platformAvailable ? `${credits.infographicsLeft} infographic${credits.infographicsLeft === 1 ? '' : 's'} left` : 'paused right now'}
              </span>
            </div>
          </div>
          <Badge tone={credits.nextSource === 'credits' ? 'ok' : 'neutral'}>
            {credits.nextSource === 'credits' ? 'Paying with credits' : credits.nextSource === 'own_key' ? 'Paying with your key' : 'Nothing to pay with'}
          </Badge>
        </div>
        <p className="iv-muted small mb-0">
          Each infographic uses {cost} credits. Credits are used first; when they run out, generation continues on your own Kie.ai key below. A
          generation that fails gives its credits back.
        </p>
        {credits.transactions?.length > 0 && (
          <div>
            {credits.transactions.slice(0, 6).map((entry) => (
              <div key={entry.id} className="iv-credit-row">
                <span>
                  {CREDIT_REASONS[entry.reason] || entry.reason}
                  <span className="iv-muted"> · {formatRelative(entry.createdAt)}</span>
                </span>
                <span className={`iv-credit-row__amount ${entry.amount > 0 ? 'is-plus' : ''}`}>
                  {entry.amount > 0 ? '+' : ''}
                  {entry.amount}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default function ApiSettings() {
  const { appName } = useBranding();
  const { isPreview } = useAuth();
  const { toast } = useToast();
  const { credential, credits, loading, error, reload, setCredential } = useKeyStatus();
  const [replacing, setReplacing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const remove = async () => {
    setRemoving(true);
    try {
      await settingsApi.deleteCredential(PROVIDER.key);
      setCredential(null);
      setConfirmRemove(false);
      toast.success('Key removed. Once your credits run out, generation stops until you connect a key again.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRemoving(false);
    }
  };

  let body;
  if (loading && !credential) {
    body = <Skeleton height={140} />;
  } else if (error) {
    body = (
      <div className="iv-alert iv-alert--danger" role="alert">
        <AlertTriangle aria-hidden="true" />
        <span>
          Could not load your key status: {errorMessage(error)}{' '}
          <button type="button" className="btn btn-iv-link btn-sm" onClick={reload}>
            Try again
          </button>
        </span>
      </div>
    );
  } else if (credential && !replacing) {
    body = <Connected credential={credential} onReplace={() => setReplacing(true)} onRemove={() => setConfirmRemove(true)} onTested={setCredential} />;
  } else {
    body = (
      <KeyForm
        replacing={Boolean(credential)}
        disabled={isPreview}
        onCancel={credential ? () => setReplacing(false) : undefined}
        onSaved={(saved) => {
          setCredential(saved);
          setReplacing(false);
        }}
      />
    );
  }

  return (
    <div className="iv-container iv-container--medium">
      <PageHeader
        title="API Settings"
        description={`Your ${appName} credits pay for infographics first. When they run out, your own Kie.ai key (BYOK) takes over and uses your Kie.ai account.`}
      />

      <div className="row g-4">
        <div className="col-lg-8 d-flex flex-column gap-4">
          <CreditsCard credits={credits} />
          <section className="iv-card">
            <div className="iv-integration-card__head">
              <span className="iv-integration-card__logo" aria-hidden="true">
                <Sparkles size={22} />
              </span>
              <div className="iv-integration-card__title">
                <h2>Kie.ai · Z-Image</h2>
                <p>Image generation for your infographics through Kie.ai&apos;s Z-Image model.</p>
              </div>
              {credential ? <StatusBadge status={credential.status} map={CREDENTIAL_STATUSES} /> : <Badge>Not connected</Badge>}
            </div>
            <div className="iv-card__body">{body}</div>
            <div className="iv-card__foot">
              <Button variant="link" size="sm" href={PROVIDER.keyPageUrl} iconRight={ExternalLink}>
                Get a Kie.ai API key
              </Button>
              <div className="flex-grow-1" />
              {credential?.status === 'valid' && (
                <Button variant="secondary" size="sm" to={ROUTES.create} icon={Sparkles}>
                  Create an infographic
                </Button>
              )}
            </div>
          </section>
        </div>

        <div className="col-lg-4 d-flex flex-column gap-4">
          <Card title="How to connect">
            <ol className="iv-steps-list">
              <li>
                Sign in at kie.ai
                <span>Create a free account if you do not have one.</span>
              </li>
              <li>
                Copy an API key
                <span>Open the API key page and create or copy a key.</span>
              </li>
              <li>
                Paste it here
                <span>We verify it with a free balance check, then encrypt it.</span>
              </li>
            </ol>
          </Card>
          <Card title="How your key is protected">
            <ul className="iv-security-list">
              <li>
                <Lock aria-hidden="true" />
                Encrypted on the server (AES-256-GCM) and bound to your account.
              </li>
              <li>
                <Lock aria-hidden="true" />
                Never shown again, never logged, never visible to administrators.
              </li>
              <li>
                <Lock aria-hidden="true" />
                Used only for your own generations once your credits run out, in the web app and through MCP.
              </li>
            </ul>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title="Remove your Kie.ai key?"
        message={`The encrypted key is erased from ${appName}. Once your credits run out you cannot generate (here or through MCP) until you connect a key again. Generations already running keep going at Kie.ai.`}
        confirmLabel="Remove key"
        danger
        loading={removing}
        onConfirm={remove}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}
