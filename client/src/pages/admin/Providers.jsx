import { useState } from 'react';
import { Cpu, KeyRound } from 'lucide-react';
import Card from '../../components/common/Card.jsx';
import Switch from '../../components/common/Switch.jsx';
import Badge from '../../components/common/Badge.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import { Skeleton } from '../../components/common/Loader.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { useToast } from '../../hooks/useToast.js';
import { adminApi } from '../../services/adminApi.js';
import { errorMessage } from '../../services/api.js';

const KIND_LABEL = { image: 'Image', video: 'Video', audio: 'Voice' };

/** The provider and its model catalogue. Turning a model off removes it from every form, API and AI-app tool at once. */
export default function Providers() {
  const { toast } = useToast();
  const resource = useApiResource((signal) => adminApi.listProviders({ signal }));
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    setBusy(true);
    try {
      const result = await adminApi.setModel(pending.provider, pending.model.id, pending.enabled);
      resource.setData(result);
      toast.success(`${pending.model.label} ${pending.enabled ? 'enabled' : 'turned off'}`);
      setPending(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (resource.loading && !resource.data) return <Skeleton height={360} />;
  if (resource.error) return <ErrorState plain title="Could not load providers" error={resource.error} onRetry={resource.reload} />;

  return (
    <div className="d-flex flex-column gap-4">
      {resource.data.providers.map((provider) => (
        <Card
          key={provider.key}
          title={
            <span className="d-inline-flex align-items-center gap-2">
              <Cpu size={16} aria-hidden="true" /> <span className="iv-gradient-text">{provider.name}</span>
            </span>
          }
          subtitle={provider.note}
        >
          <dl className="iv-kv mb-3">
            <div className="iv-kv__row">
              <dt>API host</dt>
              <dd className="iv-mono">{provider.apiHost}</dd>
            </div>
            <div className="iv-kv__row">
              <dt>Upload host</dt>
              <dd className="iv-mono">{provider.uploadHost}</dd>
            </div>
            <div className="iv-kv__row">
              <dt>
                <KeyRound size={13} aria-hidden="true" /> Saved user keys
              </dt>
              <dd>
                {provider.keys.saved} {provider.keys.invalid > 0 && <Badge tone="danger">{provider.keys.invalid} rejected by the provider</Badge>}
              </dd>
            </div>
          </dl>

          <div className="table-responsive">
            <table className="iv-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Type</th>
                  <th>Used for</th>
                  <th>Failed (24 h)</th>
                  <th>Available</th>
                </tr>
              </thead>
              <tbody>
                {provider.models.map((model) => (
                  <tr key={model.id}>
                    <td>
                      <span className="d-block">{model.label}</span>
                      <span className="iv-table__sub iv-mono">{model.id}</span>
                    </td>
                    <td>{KIND_LABEL[model.kind] || model.kind}</td>
                    <td className="small">{model.usedFor.length ? model.usedFor.join(', ') : <span className="iv-muted">API only (/api/jobs)</span>}</td>
                    <td>{model.failed24h > 0 ? <Badge tone="danger">{model.failed24h}</Badge> : <span className="iv-muted small">0</span>}</td>
                    <td>
                      <Switch
                        label={model.enabled ? 'On' : 'Off'}
                        checked={model.enabled}
                        onChange={(enabled) => setPending({ provider: provider.key, model, enabled })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small iv-muted mt-2 mb-0">
            A model that is off is refused by the API and by AI-app tools. Infographics use Z-Image: turning it off pauses
            infographic generation for everyone until it is back on. Models marked "API only" are not used by the app's forms.
          </p>
        </Card>
      ))}

      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.enabled ? 'Turn this model on?' : 'Turn this model off?'}
        message={
          pending?.enabled
            ? `${pending?.model.label} becomes available to every user again.`
            : `${pending?.model.label} will no longer be offered or accepted. ${pending?.model.usedFor.length ? `Affects: ${pending.model.usedFor.join(', ')}.` : ''}`
        }
        confirmLabel={pending?.enabled ? 'Turn on' : 'Turn off'}
        danger={!pending?.enabled}
        loading={busy}
        onConfirm={apply}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
