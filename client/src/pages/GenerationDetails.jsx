import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, RefreshCw, Trash2, Pencil, AlertTriangle, Maximize2 } from 'lucide-react';
import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import { StatusBadge } from '../components/common/Badge.jsx';
import ErrorState from '../components/common/ErrorState.jsx';
import ConfirmDialog from '../components/common/ConfirmDialog.jsx';
import GeneratingLoader from '../components/common/GeneratingLoader.jsx';
import Loader from '../components/common/Loader.jsx';
import Lightbox from '../components/infographic/Lightbox.jsx';
import ErrorHelp from '../components/infographic/ErrorHelp.jsx';
import { useInfographic, ACTIVE_STATUSES } from '../hooks/useInfographic.js';
import { useKeyStatus } from '../hooks/useKeyStatus.js';
import { useToast } from '../hooks/useToast.js';
import { infographicApi, imageUrl, downloadUrl, newIdempotencyKey } from '../services/infographicApi.js';
import { errorMessage } from '../services/api.js';
import { INFOGRAPHIC_STATUSES, INFOGRAPHIC_STYLES, INFOGRAPHIC_RATIOS, ROUTES } from '../utils/constants.js';
import { formatDateTime, formatBytes } from '../utils/formatters.js';

const STYLE_LABEL = Object.fromEntries(INFOGRAPHIC_STYLES.map((s) => [s.value, s.label]));
const RATIO_LABEL = Object.fromEntries(INFOGRAPHIC_RATIOS.map((r) => [r.value, r.label]));

/** One infographic: full image, settings, download, regenerate and delete. */
export default function GenerationDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const keyStatus = useKeyStatus();
  const { item, error, loading } = useInfographic(id);
  const [lightbox, setLightbox] = useState(false);
  const [working, setWorking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);

  if (loading && !item) return <Loader label="Loading infographic" />;
  if (error && !item) {
    return (
      <div className="iv-container iv-container--medium">
        <ErrorState
          title={error.status === 404 ? 'Infographic not found' : 'Could not load this infographic'}
          error={error.status === 404 ? 'It may have been deleted, or it belongs to another account.' : error}
          action={<Button variant="secondary" size="sm" to={ROUTES.generations}>Back to My Generations</Button>}
        />
      </div>
    );
  }
  if (!item) return null;

  const active = ACTIVE_STATUSES.has(item.status);
  const src = imageUrl(item);

  const regenerate = async () => {
    setWorking(true);
    try {
      const result = await infographicApi.regenerate(item.id, { idempotencyKey: newIdempotencyKey() });
      navigate(`${ROUTES.create}?id=${result.infographic.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setWorking(false);
    }
  };

  const remove = async () => {
    setWorking(true);
    try {
      await infographicApi.remove(item.id);
      toast.success('Infographic deleted');
      navigate(ROUTES.generations, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
      setWorking(false);
      setConfirmDelete(false);
    }
  };

  let media;
  if (active) {
    media = <GeneratingLoader aspectRatio={item.aspectRatio} title="Generating your infographic" detail={item.progress?.message} startedAt={item.createdAt} compact />;
  } else if (item.status === 'completed' && src && !imageBroken) {
    media = <img src={src} alt={`Infographic: ${item.title}`} onClick={() => setLightbox(true)} onError={() => setImageBroken(true)} />;
  } else {
    media = (
      <div className="iv-failed">
        <span className="iv-state__icon iv-state__icon--danger" aria-hidden="true">
          <AlertTriangle />
        </span>
        <h3 className="iv-state__title">{item.status === 'completed' ? 'The image file is missing' : 'This infographic could not be generated'}</h3>
        <ErrorHelp error={item.error} />
      </div>
    );
  }

  return (
    <div className="iv-container">
      <PageHeader
        backTo={ROUTES.generations}
        backLabel="My Generations"
        title={item.title}
        actions={<StatusBadge status={item.status} map={INFOGRAPHIC_STATUSES} />}
      />
      <div className="iv-detail">
        <div className="iv-detail__media">{media}</div>
        <div className="d-flex flex-column gap-3">
          <Card title="Details">
            <dl className="iv-kv">
              <div className="iv-kv__row">
                <dt>Style</dt>
                <dd>{STYLE_LABEL[item.style] || item.style}</dd>
              </div>
              <div className="iv-kv__row">
                <dt>Aspect ratio</dt>
                <dd>
                  {item.aspectRatio} {RATIO_LABEL[item.aspectRatio] ? `· ${RATIO_LABEL[item.aspectRatio]}` : ''}
                </dd>
              </div>
              {item.image && (
                <div className="iv-kv__row">
                  <dt>Image</dt>
                  <dd>
                    {item.image.width}×{item.image.height} · {formatBytes(item.image.size)}
                  </dd>
                </div>
              )}
              <div className="iv-kv__row">
                <dt>Created</dt>
                <dd>{formatDateTime(item.createdAt)}</dd>
              </div>
              <div className="iv-kv__row">
                <dt>Source</dt>
                <dd>{item.source === 'mcp' ? 'AI assistant (MCP)' : 'Web dashboard'}</dd>
              </div>
            </dl>
            <p className="iv-field__label mt-3 mb-1">Topic</p>
            <p className="small iv-muted" style={{ whiteSpace: 'pre-wrap' }}>
              {item.topic}
            </p>
          </Card>
          <div className="d-flex flex-column gap-2">
            {item.status === 'completed' && src && !imageBroken && (
              <>
                <Button icon={Download} href={downloadUrl(item)} target="_self" download block>
                  Download PNG
                </Button>
                <Button variant="secondary" icon={Maximize2} onClick={() => setLightbox(true)} block>
                  Full preview
                </Button>
              </>
            )}
            {!active && (
              <Button variant="secondary" icon={RefreshCw} onClick={regenerate} loading={working} disabled={!keyStatus.usable} block>
                Regenerate
              </Button>
            )}
            <Button variant="secondary" icon={Pencil} to={`${ROUTES.create}?id=${item.id}`} block>
              Open in editor
            </Button>
            {!active && (
              <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)} block>
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>
      <Lightbox open={lightbox} src={src} title={item.title} downloadHref={downloadUrl(item)} onClose={() => setLightbox(false)} />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this infographic?"
        message="The image and its details are removed from your history. This cannot be undone."
        confirmLabel="Delete"
        danger
        loading={working}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
