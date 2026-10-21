import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Images, Sparkles, Download, Eye, Loader2, ImageOff, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import PageHeader from '../components/common/PageHeader.jsx';
import Button from '../components/common/Button.jsx';
import Tabs from '../components/common/Tabs.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import ErrorState from '../components/common/ErrorState.jsx';
import { StatusBadge } from '../components/common/Badge.jsx';
import { Skeleton } from '../components/common/Loader.jsx';
import Lightbox from '../components/infographic/Lightbox.jsx';
import { useApiResource } from '../hooks/useApiResource.js';
import { useAuth } from '../hooks/useAuth.js';
import { infographicApi, imageUrl, downloadUrl } from '../services/infographicApi.js';
import { INFOGRAPHIC_STATUSES, INFOGRAPHIC_STYLES, ROUTES } from '../utils/constants.js';
import { formatDate, formatRelative } from '../utils/formatters.js';

const PAGE_SIZE = 24;
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Ready' },
  { key: 'active', label: 'In progress' },
  { key: 'failed', label: 'Failed' },
];
const STYLE_LABEL = Object.fromEntries(INFOGRAPHIC_STYLES.map((s) => [s.value, s.label]));

function CardMedia({ item, onOpen }) {
  const [broken, setBroken] = useState(false);
  const src = imageUrl(item);
  let content;
  if (item.status === 'completed' && src && !broken) {
    content = <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
  } else if (item.status === 'queued' || item.status === 'processing') {
    content = (
      <span className="iv-gen-card__placeholder iv-gen-card__placeholder--active">
        <Loader2 aria-hidden="true" />
        {item.progress?.message || 'Generating'}
      </span>
    );
  } else if (item.status === 'completed') {
    content = (
      <span className="iv-gen-card__placeholder">
        <ImageOff aria-hidden="true" />
        Image unavailable
      </span>
    );
  } else {
    content = (
      <span className="iv-gen-card__placeholder iv-gen-card__placeholder--failed">
        <AlertTriangle aria-hidden="true" />
        {item.status === 'cancelled' ? 'Cancelled' : 'Generation failed'}
      </span>
    );
  }
  return (
    <button type="button" className="iv-gen-card__media" onClick={onOpen} aria-label={`Open ${item.title}`}>
      {content}
      <span className="iv-gen-card__status">
        <StatusBadge status={item.status} map={INFOGRAPHIC_STATUSES} />
      </span>
      <span className="iv-gen-card__ratio">{item.aspectRatio}</span>
    </button>
  );
}

export default function MyGenerations() {
  const navigate = useNavigate();
  const { isPreview } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = FILTERS.some((f) => f.key === params.get('status')) ? params.get('status') : 'all';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [preview, setPreview] = useState(null);

  const list = useApiResource(
    (signal) => (isPreview ? Promise.resolve({ items: [], total: 0, page: 1, pages: 1 }) : infographicApi.list({ status, page, limit: PAGE_SIZE }, { signal })),
    [status, page, isPreview],
  );
  const items = list.data?.items || [];
  const pages = list.data?.pages || 1;
  const hasActive = items.some((item) => item.status === 'queued' || item.status === 'processing');

  // Refresh quietly while something on this page is still generating.
  useEffect(() => {
    if (!hasActive) return undefined;
    const timer = setInterval(list.reload, 5000);
    return () => clearInterval(timer);
  }, [hasActive, list.reload]);

  const setFilter = (key) => setParams(key === 'all' ? {} : { status: key });
  const goPage = (next) => setParams({ ...(status !== 'all' ? { status } : {}), page: String(next) });
  const open = (item) => (item.status === 'completed' && imageUrl(item) ? setPreview(item) : navigate(ROUTES.generation(item.id)));

  let body;
  if (list.loading && !list.data) {
    body = (
      <div className="iv-gallery" aria-busy="true">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} height={340} />
        ))}
      </div>
    );
  } else if (list.error) {
    body = <ErrorState title="Could not load your generations" error={list.error} onRetry={list.reload} />;
  } else if (!items.length) {
    body =
      status === 'all' ? (
        <EmptyState
          icon={Images}
          title="No infographics yet"
          description="Everything you generate is saved here, newest first, ready to preview and download."
          action={
            <Button icon={Sparkles} to={ROUTES.create}>
              Create your first infographic
            </Button>
          }
        />
      ) : (
        <EmptyState icon={Images} title="Nothing here" description="No infographics match this filter." action={<Button variant="secondary" onClick={() => setFilter('all')}>Show all</Button>} />
      );
  } else {
    body = (
      <>
        <div className="iv-gallery">
          {items.map((item) => (
            <article key={item.id} className="iv-gen-card">
              <CardMedia item={item} onOpen={() => open(item)} />
              <div className="iv-gen-card__body">
                <h3 className="iv-gen-card__title" title={item.title}>
                  {item.title}
                </h3>
                <div className="iv-gen-card__meta">
                  <span title={formatDate(item.createdAt)}>{formatRelative(item.createdAt)}</span>
                  <i aria-hidden="true" />
                  <span>{STYLE_LABEL[item.style] || item.style}</span>
                </div>
              </div>
              <div className="iv-gen-card__actions">
                <Button variant="secondary" size="sm" icon={Eye} to={ROUTES.generation(item.id)} aria-label={`Details of ${item.title}`}>
                  Preview
                </Button>
                {item.status === 'completed' && item.image && (
                  <Button variant="secondary" size="sm" icon={Download} href={downloadUrl(item)} target="_self" download aria-label={`Download ${item.title}`}>
                    Download
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
        {pages > 1 && (
          <div className="iv-pagination">
            <span className="iv-pagination__info">
              Page {page} of {pages} · {list.data.total} infographics
            </span>
            <div className="d-flex gap-2">
              <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => goPage(page - 1)}>
                Previous
              </Button>
              <Button variant="secondary" size="sm" iconRight={ChevronRight} disabled={page >= pages} onClick={() => goPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="iv-container">
      <PageHeader
        title="My Generations"
        description="Your infographics, newest first. Only you can see them."
        actions={
          <Button icon={Sparkles} to={ROUTES.create}>
            New infographic
          </Button>
        }
      />
      <div className="iv-gallery-toolbar">
        <Tabs tabs={FILTERS} value={status} onChange={setFilter} ariaLabel="Filter by status" />
        {list.data && <span className="iv-muted small">{list.data.total} total</span>}
      </div>
      {body}
      <Lightbox open={Boolean(preview)} src={imageUrl(preview)} title={preview?.title} downloadHref={downloadUrl(preview)} onClose={() => setPreview(null)} />
    </div>
  );
}
