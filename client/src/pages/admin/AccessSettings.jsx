import { useEffect, useState } from 'react';
import { Save, ShieldAlert } from 'lucide-react';
import Card from '../../components/common/Card.jsx';
import Switch from '../../components/common/Switch.jsx';
import Input from '../../components/common/Input.jsx';
import Button from '../../components/common/Button.jsx';
import Badge from '../../components/common/Badge.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import { Skeleton } from '../../components/common/Loader.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { useToast } from '../../hooks/useToast.js';
import { adminApi } from '../../services/adminApi.js';
import { errorMessage } from '../../services/api.js';
import { formatDateTime } from '../../utils/formatters.js';

function toForm(settings) {
  return {
    ...settings.access,
    userConcurrency: String(settings.limits.userConcurrency),
    workerConcurrency: String(settings.limits.workerConcurrency),
  };
}

/** App access (sign-ups, maintenance, generation, AI apps) and concurrency. Applied by the server on every request and job. */
export default function AccessSettings() {
  const { toast } = useToast();
  const resource = useApiResource((signal) => adminApi.getSettings({ signal }));
  const settings = resource.data?.settings;
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) setForm(toForm(settings));
  }, [settings]);

  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value?.target ? value.target.value : value }));

  const save = async (event) => {
    event.preventDefault();
    const next = {};
    const userConcurrency = Number(form.userConcurrency);
    const workerConcurrency = Number(form.workerConcurrency);
    if (!Number.isInteger(userConcurrency) || userConcurrency < 1 || userConcurrency > 20) next.userConcurrency = 'Use a whole number from 1 to 20';
    if (!Number.isInteger(workerConcurrency) || workerConcurrency < 1 || workerConcurrency > 50) next.workerConcurrency = 'Use a whole number from 1 to 50';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const result = await adminApi.updateSettings({
        access: {
          signupEnabled: form.signupEnabled,
          maintenanceMode: form.maintenanceMode,
          maintenanceMessage: form.maintenanceMessage,
          generationEnabled: form.generationEnabled,
          generationPausedMessage: form.generationPausedMessage,
          mcpEnabled: form.mcpEnabled,
        },
        limits: { userConcurrency, workerConcurrency },
      });
      resource.setData({ settings: result.settings });
      toast.success('Access and limits saved. They apply within a few seconds.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (resource.loading && !settings) return <Skeleton height={360} />;
  if (resource.error) return <ErrorState plain title="Could not load the settings" error={resource.error} onRetry={resource.reload} />;
  if (!form) return null;

  return (
    <form className="d-flex flex-column gap-4" onSubmit={save} noValidate>
      <Card title={<span className="iv-gradient-text">App access</span>} subtitle="Who can use the app and what they can start. Administrators are never locked out.">
        <div className="d-flex flex-column gap-3">
          <Switch
            label="Allow new sign-ups"
            checked={form.signupEnabled}
            onChange={set('signupEnabled')}
            hint="When off, the sign-up form is refused; existing accounts and admin-created access are unaffected."
          />
          <Switch
            label="Maintenance mode"
            checked={form.maintenanceMode}
            onChange={set('maintenanceMode')}
            hint="Only administrators can sign in and use the app. Running generations continue; AI apps are paused too."
          />
          {form.maintenanceMode && (
            <Input label="Message shown to users" value={form.maintenanceMessage} onChange={set('maintenanceMessage')} maxLength={300} />
          )}
          <Switch
            label="Allow new generations"
            checked={form.generationEnabled}
            onChange={set('generationEnabled')}
            hint="When off, nothing new is sent to the provider: new infographics, jobs and retries are refused, and queued jobs wait. Tasks already at the provider finish."
          />
          {!form.generationEnabled && (
            <Input label="Message shown when generation is paused" value={form.generationPausedMessage} onChange={set('generationPausedMessage')} maxLength={300} />
          )}
          <Switch
            label="Allow AI apps (MCP)"
            checked={form.mcpEnabled}
            onChange={set('mcpEnabled')}
            disabled={!settings.environment.mcpEnabled}
            hint={
              settings.environment.mcpEnabled
                ? 'When off, connected AI apps get "temporarily unavailable" and no new connection can be approved. Existing connections are kept.'
                : 'The MCP server is turned off on this server (MCP_ENABLED=false).'
            }
          />
        </div>
      </Card>

      <Card title={<span className="iv-gradient-text">Concurrency</span>} subtitle="How much runs at the same time. Lower values protect the provider account and the server.">
        <div className="iv-form-grid iv-form-grid--2">
          <Input
            label="Jobs per user at the provider"
            type="number"
            min={1}
            max={20}
            value={form.userConcurrency}
            onChange={set('userConcurrency')}
            error={errors.userConcurrency}
            hint="Further jobs of the same user wait for a free slot (1 to 20)."
          />
          <Input
            label="Jobs per worker process"
            type="number"
            min={1}
            max={50}
            value={form.workerConcurrency}
            onChange={set('workerConcurrency')}
            error={errors.workerConcurrency}
            hint={settings.environment.workerEnabled ? 'Jobs one API process advances at once (1 to 50).' : 'The worker is off in this process (WORKER_ENABLED=false).'}
          />
        </div>
      </Card>

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
        <span className="small iv-muted d-inline-flex align-items-center gap-2">
          <ShieldAlert size={14} aria-hidden="true" />
          {settings.updatedAt ? `Last changed ${formatDateTime(settings.updatedAt)} by ${settings.updatedBy}` : 'Using the defaults from the server configuration.'}
          {settings.disabledModels.length > 0 && <Badge tone="warning">{settings.disabledModels.length} model(s) turned off</Badge>}
        </span>
        <Button type="submit" icon={Save} loading={saving}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
