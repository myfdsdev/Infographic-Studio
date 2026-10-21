import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plug, Copy, Check, AlertTriangle, CheckCircle2, Unplug, ShieldCheck, Info, Wrench, KeyRound } from 'lucide-react';
import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Badge from '../components/common/Badge.jsx';
import Tabs from '../components/common/Tabs.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import ErrorState from '../components/common/ErrorState.jsx';
import ConfirmDialog from '../components/common/ConfirmDialog.jsx';
import { Skeleton } from '../components/common/Loader.jsx';
import { useApiResource } from '../hooks/useApiResource.js';
import { useKeyStatus } from '../hooks/useKeyStatus.js';
import { useToast } from '../hooks/useToast.js';
import { useAuth } from '../hooks/useAuth.js';
import { useBranding } from '../hooks/useBranding.js';
import { mcpApi } from '../services/mcpApi.js';
import { errorMessage } from '../services/api.js';
import { ROUTES } from '../utils/constants.js';
import { formatRelative, formatDateTime } from '../utils/formatters.js';

function useCopy() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(null);
  const copy = async (text, key = text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((value) => (value === key ? null : value)), 1600);
    } catch {
      toast.error('Copy failed. Select the text and copy it manually.');
    }
  };
  return { copied, copy };
}

function CodeBlock({ code, copyKey, copy, copied }) {
  return (
    <div className="iv-code">
      <pre>{code}</pre>
      <Button variant="secondary" size="sm" icon={copied === copyKey ? Check : Copy} onClick={() => copy(code, copyKey)}>
        {copied === copyKey ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function slug(name) {
  return String(name || 'infographic-studio')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function setupFor(client, url, serverName) {
  switch (client) {
    case 'claude-code':
      return {
        steps: ['Run this command in a terminal.', 'In Claude Code, run /mcp and choose Authenticate.', 'Approve the connection in this browser while signed in.'],
        code: `claude mcp add --transport http ${serverName} ${url}`,
      };
    case 'cursor':
      return {
        steps: ['Open Cursor Settings → MCP → Add new MCP server, or edit ~/.cursor/mcp.json.', 'Paste this configuration and save.', 'Click Connect and approve the connection in this browser.'],
        code: JSON.stringify({ mcpServers: { [serverName]: { url } } }, null, 2),
      };
    case 'other':
      return {
        steps: [
          'Add a remote MCP server using Streamable HTTP.',
          'Use this URL. Authentication is OAuth 2.1 with discovery, so no token needs to be pasted.',
          'Approve the connection in this browser when your client opens it.',
        ],
        code: url,
      };
    default:
      return {
        steps: [
          'In Claude, open Settings → Connectors → Add custom connector.',
          'Enter a name and paste the server URL below.',
          'Click Connect, then approve the connection in this browser while signed in.',
        ],
        code: url,
      };
  }
}

const CLIENT_TABS = [
  { key: 'claude', label: 'Claude' },
  { key: 'claude-code', label: 'Claude Code' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'other', label: 'Other clients' },
];

export default function McpConnection() {
  const { appName } = useBranding();
  const { isPreview } = useAuth();
  const { toast } = useToast();
  const keyStatus = useKeyStatus();
  const { copied, copy } = useCopy();
  const [client, setClient] = useState('claude');
  const [revoking, setRevoking] = useState(null);
  const [busy, setBusy] = useState(false);

  const info = useApiResource((signal) => (isPreview ? Promise.resolve(null) : mcpApi.info({ signal })), [isPreview]);
  const connections = useApiResource((signal) => (isPreview ? Promise.resolve({ items: [] }) : mcpApi.listConnections({ signal })), [isPreview]);
  const activity = useApiResource((signal) => (isPreview ? Promise.resolve({ items: [] }) : mcpApi.activity({ signal })), [isPreview]);

  const data = info.data;
  const active = (connections.data?.items || []).filter((item) => item.status === 'active');
  const recentFailures = (activity.data?.items || []).filter((item) => item.outcome === 'failure').slice(0, 5);
  const serverName = slug(appName);
  const setup = data ? setupFor(client, data.url, serverName) : null;

  const revoke = async () => {
    setBusy(true);
    try {
      await mcpApi.revokeConnection(revoking.id);
      toast.success(`${revoking.clientName} disconnected`);
      setRevoking(null);
      connections.reload();
      activity.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  let status;
  if (info.loading && !data) status = <Skeleton height={72} />;
  else if (info.error) status = <ErrorState plain title="Could not load the MCP server details" error={info.error} onRetry={info.reload} />;
  else if (!data)
    status = (
      <div className="iv-alert iv-alert--info">
        <Info aria-hidden="true" />
        <span>Sign in to see your connection details.</span>
      </div>
    );
  else {
    const available = data.available !== false && data.enabled;
    status = (
      <div className="iv-connected">
        <span className={`iv-connected__icon ${available ? '' : 'iv-connected__icon--bad'}`} aria-hidden="true">
          {available ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
        </span>
        <div className="iv-connected__text">
          <strong>{available ? (active.length ? `${active.length} AI app${active.length === 1 ? '' : 's'} connected` : 'Ready to connect') : 'MCP access is turned off'}</strong>
          <span>{available ? `${data.transport} · ${data.authentication}` : 'An administrator has paused AI-app access. Try again later.'}</span>
        </div>
        <Badge tone={available ? 'ok' : 'danger'} dot>
          {available ? 'Online' : 'Offline'}
        </Badge>
      </div>
    );
  }

  return (
    <div className="iv-container iv-container--medium">
      <PageHeader
        title="MCP Connection"
        description={`Generate infographics from Claude, Cursor and other AI assistants. They act as you, with your own Kie.ai key, after you approve them.`}
      />

      <div className="d-flex flex-column gap-4">
        <section className="iv-card">
          <div className="iv-integration-card__head">
            <span className="iv-integration-card__logo" aria-hidden="true">
              <Plug size={22} />
            </span>
            <div className="iv-integration-card__title">
              <h2>{appName} MCP server</h2>
              <p>Authenticated with OAuth. Each assistant only sees your infographics, never your API key.</p>
            </div>
          </div>
          <div className="iv-card__body d-flex flex-column gap-4">
            {status}
            {data && (
              <div className="iv-field">
                <span className="iv-field__label">Server URL</span>
                <div className="iv-copy">
                  <code>{data.url}</code>
                  <Button variant="secondary" size="sm" icon={copied === 'url' ? Check : Copy} onClick={() => copy(data.url, 'url')}>
                    {copied === 'url' ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                {!data.reachability?.cloudClients && (
                  <span className="iv-field__hint">
                    This address is not public HTTPS, so cloud clients (Claude on the web or desktop, ChatGPT) cannot reach it. Local clients on this computer, such as Claude Code, can. Deploy behind HTTPS for cloud clients.
                  </span>
                )}
              </div>
            )}
            {!keyStatus.loading && !keyStatus.usable && !isPreview && (
              <div className="iv-key-callout">
                <KeyRound size={18} aria-hidden="true" />
                <div>
                  <strong>Connect your Kie.ai key first</strong>
                  <p>
                    Assistants can list your infographics, but generate_infographic is refused until your own key is connected.{' '}
                    <Link to={ROUTES.apiSettings} className="fw-semibold">
                      Open API Settings
                    </Link>
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {setup && (
          <Card title="Set up your client" subtitle="No secret token is ever copied: you approve each assistant in this browser.">
            <div className="d-flex flex-column gap-3">
              <Tabs tabs={CLIENT_TABS} value={client} onChange={setClient} ariaLabel="MCP client" />
              <ol className="iv-steps-list">
                {setup.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <CodeBlock code={setup.code} copyKey={`setup-${client}`} copy={copy} copied={copied} />
            </div>
          </Card>
        )}

        <Card title="Available tools" subtitle="What a connected assistant can do. Paid tools always ask for your confirmation first.">
          <div className="iv-tool-grid">
            {(data?.tools || []).map((tool) => (
              <div key={tool.name} className="iv-tool">
                <div className="iv-tool__name">
                  <code>{tool.name}</code>
                  {tool.paid ? <Badge tone="warning">Uses credits</Badge> : <Badge tone="ok">Free</Badge>}
                </div>
                <p>{tool.description || tool.title}</p>
              </div>
            ))}
            {!data?.tools?.length && <span className="iv-muted small">Tools appear here when the server details load.</span>}
          </div>
        </Card>

        <Card title="Connected apps" subtitle="Disconnect an app to revoke its access immediately.">
          {connections.loading && !connections.data ? (
            <Skeleton height={64} />
          ) : connections.error ? (
            <ErrorState plain title="Could not load your connections" error={connections.error} onRetry={connections.reload} />
          ) : active.length === 0 ? (
            <EmptyState plain icon={Plug} title="No apps connected yet" description="Follow the setup steps above. Approved apps appear here." />
          ) : (
            <div>
              {active.map((item) => (
                <div key={item.id} className="iv-connection">
                  <div className="iv-connection__main">
                    <strong>{item.clientName}</strong>
                    <span>
                      Connected {formatRelative(item.createdAt)} · {item.lastUsedAt ? `last used ${formatRelative(item.lastUsedAt)}${item.lastTool ? ` (${item.lastTool})` : ''}` : 'not used yet'}
                    </span>
                    <div className="d-flex flex-wrap gap-1 mt-1">
                      {item.scopes.map((scope) => (
                        <Badge key={scope.id} tone={scope.paid ? 'warning' : 'neutral'}>
                          {scope.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button variant="danger" size="sm" icon={Unplug} onClick={() => setRevoking(item)}>
                    Disconnect
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="row g-4">
          <div className="col-md-6">
            <Card title="Troubleshooting">
              <ul className="iv-security-list">
                <li>
                  <Wrench aria-hidden="true" />
                  <span>
                    <strong className="text-body">Connection fails in Claude or ChatGPT:</strong> the server needs a public HTTPS address.
                  </span>
                </li>
                <li>
                  <Wrench aria-hidden="true" />
                  <span>
                    <strong className="text-body">NO_API_KEY or API_KEY_INVALID:</strong> connect or replace your key in API Settings.
                  </span>
                </li>
                <li>
                  <Wrench aria-hidden="true" />
                  <span>
                    <strong className="text-body">insufficient_scope:</strong> reconnect and allow &quot;Generate infographics&quot; on the approval page.
                  </span>
                </li>
                <li>
                  <Wrench aria-hidden="true" />
                  <span>
                    <strong className="text-body">Stopped working:</strong> unused connections expire after {data?.tokens?.refreshTokenIdleDays || 30} days, and a password change disconnects all apps. Connect again.
                  </span>
                </li>
              </ul>
            </Card>
          </div>
          <div className="col-md-6">
            <Card title="Recent errors" subtitle="Failed tool calls from your connected apps.">
              {recentFailures.length === 0 ? (
                <p className="d-flex align-items-center gap-2 iv-muted small mb-0">
                  <ShieldCheck size={16} className="text-success" aria-hidden="true" /> No recent errors.
                </p>
              ) : (
                <ul className="iv-activity">
                  {recentFailures.map((entry) => (
                    <li key={entry.id}>
                      <div className="iv-activity__body">
                        <div className="iv-activity__summary">{entry.summary}</div>
                      </div>
                      <span className="iv-activity__time" title={formatDateTime(entry.createdAt)}>
                        {formatRelative(entry.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(revoking)}
        title={`Disconnect ${revoking?.clientName || 'this app'}?`}
        message="Its access is revoked at once. It must ask for your approval again to reconnect."
        confirmLabel="Disconnect"
        danger
        loading={busy}
        onConfirm={revoke}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}
