import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Sparkles,
  Download,
  RefreshCw,
  Maximize2,
  KeyRound,
  AlertTriangle,
  X,
  Loader2,
  ImageOff,
  ArrowRight,
  Cpu,
  ArrowUp,
  Plus,
  Check,
  History,
} from "lucide-react";
import Button from "../components/common/Button.jsx";
import { StatusBadge } from "../components/common/Badge.jsx";
import GeneratingLoader from "../components/common/GeneratingLoader.jsx";
import Lightbox from "../components/infographic/Lightbox.jsx";
import ErrorHelp from "../components/infographic/ErrorHelp.jsx";
import {
  LayoutSelect,
  StyleSelect,
  RatioSelect,
} from "../components/infographic/Pickers.jsx";
import { useInfographic, ACTIVE_STATUSES } from "../hooks/useInfographic.js";
import { useApiResource } from "../hooks/useApiResource.js";
import { useKeyStatus } from "../hooks/useKeyStatus.js";
import { useToast } from "../hooks/useToast.js";
import { useAuth } from "../hooks/useAuth.js";
import {
  infographicApi,
  imageUrl,
  downloadUrl,
  newIdempotencyKey,
} from "../services/infographicApi.js";
import { errorMessage } from "../services/api.js";
import {
  INFOGRAPHIC_LAYOUTS,
  INFOGRAPHIC_STYLES,
  INFOGRAPHIC_STATUSES,
  TOPIC_MIN,
  TOPIC_MAX,
  LEGACY_RATIOS,
  ROUTES,
} from "../utils/constants.js";
import { formatRelative } from "../utils/formatters.js";

const STYLE_LABEL = Object.fromEntries(
  INFOGRAPHIC_STYLES.map((s) => [s.value, s.label]),
);
const LAYOUT_LABEL = Object.fromEntries(
  INFOGRAPHIC_LAYOUTS.map((l) => [l.value, l.label]),
);
const FEED_SIZE = 30;
// Each example also picks the infographic type that suits it.
const EXAMPLES = [
  { text: "5 benefits of AI automation for small businesses", layout: "list" },
  {
    text: "How to launch a podcast in 6 steps: plan, equipment, record, edit, publish, promote",
    layout: "steps",
  },
  {
    text: "Remote work vs office work: flexibility, focus, teamwork, commute and cost",
    layout: "comparison",
  },
  {
    text: "The water cycle: evaporation, condensation, precipitation and collection",
    layout: "cycle",
  },
];

/** "Timeline · Dark Neon · 3:4"; the default Smart layout is not named. */
function settingsLabel(item) {
  return [
    item.layout && item.layout !== "auto"
      ? LAYOUT_LABEL[item.layout] || item.layout
      : null,
    STYLE_LABEL[item.style] || item.style,
    item.aspectRatio,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Steps shown while generating, from what the server reports. */
function stepsFor(item) {
  const phase = item?.progress?.phase;
  const saving = ACTIVE_STATUSES.has(item?.status) && phase === "done";
  const sent = ["polling"].includes(phase) || saving;
  const submitting = phase === "submitting" || phase === "reconcile";
  return [
    { label: "Queued", status: sent || submitting ? "completed" : "running" },
    {
      label: "Generating with Z-Image",
      status: saving ? "completed" : sent || submitting ? "running" : "pending",
    },
    { label: "Saving your image", status: saving ? "running" : "pending" },
  ];
}

function KeyCallout({ keyStatus }) {
  const { status, nextSource, credits } = keyStatus;
  if (nextSource) return null;
  if (credits?.platformAvailable) {
    return (
      <div className="iv-composer__notice" role="status">
        <KeyRound size={16} aria-hidden="true" />
        <span>
          <strong>You are out of credits.</strong> Add your own Kie.ai API key
          to keep generating.
        </span>
        <Link to={ROUTES.apiSettings} className="iv-composer__notice-link">
          Add key <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    );
  }
  const invalid = status === "invalid";
  return (
    <div className="iv-composer__notice" role="status">
      <KeyRound size={16} aria-hidden="true" />
      <span>
        <strong>
          {invalid
            ? "Your Kie.ai key was rejected."
            : "Connect your Kie.ai API key to generate."}
        </strong>{" "}
        {invalid
          ? "Replace it to keep generating."
          : "Images run on your own Kie.ai account."}
      </span>
      <Link to={ROUTES.apiSettings} className="iv-composer__notice-link">
        {invalid ? "Replace key" : "Connect"}{" "}
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}

function FeedTile({ item, selected, onOpen }) {
  const [broken, setBroken] = useState(false);
  const src = imageUrl(item);
  const [w, h] = String(item.aspectRatio || "3:4")
    .split(":")
    .map(Number);
  let media;
  if (item.status === "completed" && src && !broken) {
    media = (
      <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
    );
  } else if (ACTIVE_STATUSES.has(item.status)) {
    media = (
      <span className="iv-tile__placeholder iv-tile__placeholder--active">
        <Loader2 aria-hidden="true" />
        Generating
      </span>
    );
  } else if (item.status === "completed") {
    media = (
      <span className="iv-tile__placeholder">
        <ImageOff aria-hidden="true" />
        Image unavailable
      </span>
    );
  } else {
    media = (
      <span className="iv-tile__placeholder iv-tile__placeholder--failed">
        <AlertTriangle aria-hidden="true" />
        {item.status === "cancelled" ? "Cancelled" : "Failed"}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`iv-tile ${selected ? "is-selected" : ""}`}
      style={{ aspectRatio: w && h ? `${w} / ${h}` : undefined }}
      onClick={onOpen}
      aria-label={`Open ${item.title}`}
      aria-current={selected ? "true" : undefined}
    >
      {media}
      <span className="iv-tile__overlay">
        <span className="iv-tile__title">{item.title}</span>
        <span className="iv-tile__meta">
          {settingsLabel(item)} · {formatRelative(item.createdAt)}
        </span>
      </span>
    </button>
  );
}

function HistoryItem({ item, selected, onOpen }) {
  const [broken, setBroken] = useState(false);
  const src = imageUrl(item);
  const activeItem = ACTIVE_STATUSES.has(item.status);
  const failed = !activeItem && item.status !== "completed";
  return (
    <button
      type="button"
      className={`iv-hist ${selected ? "is-selected" : ""}`}
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
    >
      <span className="iv-hist__thumb">
        {item.status === "completed" && src && !broken ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : activeItem ? (
          <Loader2 className="iv-spin" aria-hidden="true" />
        ) : failed ? (
          <AlertTriangle aria-hidden="true" />
        ) : (
          <ImageOff aria-hidden="true" />
        )}
      </span>
      <span className="iv-hist__text">
        <span className="iv-hist__title">{item.title}</span>
        <span className={`iv-hist__meta ${failed ? "is-failed" : ""}`}>
          {activeItem
            ? "Generating…"
            : failed
              ? item.status === "cancelled"
                ? "Cancelled"
                : "Failed"
              : settingsLabel(item)}
          {!activeItem && <> · {formatRelative(item.createdAt)}</>}
        </span>
      </span>
    </button>
  );
}

/** A miniature infographic drawn in CSS, one per style, for the start screen. */
function StylePoster({ style }) {
  return (
    <span className={`iv-poster iv-poster--${style}`} aria-hidden="true">
      <span className="iv-poster__title" />
      <span className="iv-poster__sub" />
      {[0, 1, 2].map((row) => (
        <span key={row} className="iv-poster__row">
          <span className="iv-poster__icon" />
          <span className="iv-poster__lines">
            <span />
            <span />
          </span>
        </span>
      ))}
    </span>
  );
}

export default function CreateInfographic() {
  const { toast } = useToast();
  const { isPreview } = useAuth();
  const keyStatus = useKeyStatus();
  const [params, setParams] = useSearchParams();
  const currentId = params.get("id");

  const [topic, setTopic] = useState("");
  const [layout, setLayout] = useState("auto");
  const [style, setStyle] = useState("minimal");
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [topicError, setTopicError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [lightbox, setLightbox] = useState(false);
  const loadedFor = useRef(null);
  const promptRef = useRef(null);
  const stageRef = useRef(null);

  const { item, error: loadError, setItem } = useInfographic(currentId);
  const active = item && ACTIVE_STATUSES.has(item.status);
  const busy = submitting || Boolean(active);

  const feed = useApiResource(
    (signal) =>
      isPreview
        ? Promise.resolve({ items: [], total: 0 })
        : infographicApi.list({ page: 1, limit: FEED_SIZE }, { signal }),
    [isPreview],
  );
  const feedItems = feed.data?.items || [];
  const feedActive = feedItems.some((entry) =>
    ACTIVE_STATUSES.has(entry.status),
  );
  const { reload: reloadFeed } = feed;

  // Refresh the feed quietly while something in it is still generating, and
  // once the open infographic finishes.
  useEffect(() => {
    if (!feedActive) return undefined;
    const timer = setInterval(reloadFeed, 5000);
    return () => clearInterval(timer);
  }, [feedActive, reloadFeed]);

  const itemStatus = item?.status;
  useEffect(() => {
    if (itemStatus && !ACTIVE_STATUSES.has(itemStatus)) reloadFeed();
  }, [itemStatus, reloadFeed]);

  // Opening /?id=... fills the composer with that infographic's settings once.
  useEffect(() => {
    if (item && loadedFor.current !== item.id) {
      loadedFor.current = item.id;
      setTopic(item.topic);
      setLayout(item.layout || "auto");
      setStyle(item.style);
      setAspectRatio(LEGACY_RATIOS[item.aspectRatio] || item.aspectRatio);
    }
  }, [item]);

  // The prompt grows with its text, up to a limit.
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [topic]);

  const trimmed = topic.trim();
  const tooLong = trimmed.length > TOPIC_MAX;
  const canGenerate =
    !busy &&
    !isPreview &&
    keyStatus.usable &&
    trimmed.length >= TOPIC_MIN &&
    !tooLong;

  const start = async (request) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await request();
      loadedFor.current = result.infographic.id;
      setItem(result.infographic);
      setParams({ id: result.infographic.id });
      reloadFeed();
      // Credits may have been spent.
      keyStatus.reload();
      stageRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      if (result.deduplicated)
        toast.info("This request is already being generated.");
    } catch (err) {
      setSubmitError(err);
      if (["NO_API_KEY", "API_KEY_INVALID", "NO_CREDITS"].includes(err?.code))
        keyStatus.reload();
      if (err?.details?.topic) setTopicError(err.details.topic);
    } finally {
      setSubmitting(false);
    }
  };

  const generate = (event) => {
    event?.preventDefault();
    if (trimmed.length < TOPIC_MIN) {
      setTopicError(`Describe the topic in at least ${TOPIC_MIN} characters.`);
      return;
    }
    if (tooLong) {
      setTopicError(`Keep the topic under ${TOPIC_MAX} characters.`);
      return;
    }
    start(() =>
      infographicApi.create(
        { topic: trimmed, layout, style, aspectRatio },
        { idempotencyKey: newIdempotencyKey() },
      ),
    );
  };

  const regenerate = () => {
    if (!item) return;
    start(() =>
      infographicApi.regenerate(item.id, {
        idempotencyKey: newIdempotencyKey(),
      }),
    );
  };

  const closeViewer = () => {
    loadedFor.current = null;
    setParams({});
    setItem(null);
    setSubmitError(null);
  };

  const open = (entry) => {
    setParams({ id: entry.id });
    stageRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const fillExample = ({ text, layout: exampleLayout }) => {
    setTopic(text);
    setLayout(exampleLayout);
    setTopicError(null);
    promptRef.current?.focus();
  };

  const onPromptKey = (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
      generate(event);
  };

  const src = imageUrl(item);
  const showViewer = Boolean(currentId);

  let viewer = null;
  if (showViewer) {
    let canvas;
    if (loadError && !item) {
      canvas = (
        <div className="iv-failed">
          <span
            className="iv-state__icon iv-state__icon--danger"
            aria-hidden="true"
          >
            <AlertTriangle />
          </span>
          <h3 className="iv-state__title">Could not open this infographic</h3>
          <p className="iv-muted small">{errorMessage(loadError)}</p>
          <Button variant="secondary" size="sm" onClick={closeViewer}>
            Back to studio
          </Button>
        </div>
      );
    } else if (!item) {
      canvas = (
        <div className="iv-viewer__loading" aria-busy="true">
          <Loader2 className="iv-spin" aria-hidden="true" />
        </div>
      );
    } else if (active) {
      canvas = (
        <GeneratingLoader
          aspectRatio={item.aspectRatio}
          title="Generating your infographic"
          detail={item.progress?.message}
          startedAt={item.createdAt}
          steps={stepsFor(item)}
          maxHeight="max(260px, calc(100dvh - 400px))"
        />
      );
    } else if (item.status === "completed" && src) {
      canvas = (
        <img
          src={src}
          alt={`Infographic: ${item.title}`}
          className="iv-viewer__image"
          style={{
            aspectRatio:
              item.image?.width && item.image?.height
                ? `${item.image.width} / ${item.image.height}`
                : undefined,
          }}
          onClick={() => setLightbox(true)}
        />
      );
    } else {
      canvas = (
        <div className="iv-failed">
          <span
            className="iv-state__icon iv-state__icon--danger"
            aria-hidden="true"
          >
            <AlertTriangle />
          </span>
          <h3 className="iv-state__title">
            {item.status === "cancelled"
              ? "Generation cancelled"
              : "This infographic could not be generated"}
          </h3>
          <ErrorHelp error={item.error} />
          <Button
            icon={RefreshCw}
            onClick={regenerate}
            loading={submitting}
            disabled={!keyStatus.usable || isPreview}
          >
            Try again
          </Button>
        </div>
      );
    }

    viewer = (
      <section className="iv-viewer" aria-label="Selected infographic">
        <div className="iv-viewer__bar">
          <div className="iv-viewer__info">
            <h2 className="iv-viewer__title">
              {item ? item.title : "Loading…"}
            </h2>
            {item && (
              <div className="iv-viewer__meta">
                <StatusBadge status={item.status} map={INFOGRAPHIC_STATUSES} />
                {item.layout && item.layout !== "auto" && (
                  <>
                    <span>{LAYOUT_LABEL[item.layout] || item.layout}</span>
                    <i aria-hidden="true" />
                  </>
                )}
                <span>{STYLE_LABEL[item.style] || item.style}</span>
                <i aria-hidden="true" />
                <span>{item.aspectRatio}</span>
                <i aria-hidden="true" />
                <span>{formatRelative(item.createdAt)}</span>
              </div>
            )}
          </div>
          <div className="iv-viewer__actions">
            {item?.status === "completed" && src && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Maximize2}
                  onClick={() => setLightbox(true)}
                >
                  Full view
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Download}
                  href={downloadUrl(item)}
                  target="_self"
                  download
                >
                  Download
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RefreshCw}
                  onClick={regenerate}
                  loading={submitting}
                  disabled={!keyStatus.usable || isPreview}
                >
                  Regenerate
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={X}
              onClick={closeViewer}
              aria-label="Close"
              title="Close"
            />
          </div>
        </div>
        <div className="iv-viewer__canvas">{canvas}</div>
      </section>
    );
  }

  let history;
  if (feed.loading && !feed.data) {
    history = (
      <div className="iv-rail__list" aria-busy="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <span key={index} className="iv-hist iv-hist--skeleton" />
        ))}
      </div>
    );
  } else if (feed.error) {
    history = (
      <div className="iv-feed-error">
        <AlertTriangle size={16} aria-hidden="true" />
        <span>Could not load your generations. {errorMessage(feed.error)}</span>
        <Button variant="secondary" size="sm" onClick={reloadFeed}>
          Retry
        </Button>
      </div>
    );
  } else if (feedItems.length) {
    history = (
      <div className="iv-rail__list">
        {feedItems.map((entry) => (
          <HistoryItem
            key={entry.id}
            item={entry}
            selected={entry.id === currentId}
            onOpen={() => open(entry)}
          />
        ))}
      </div>
    );
  } else if (feed.data) {
    history = (
      <p className="iv-rail__empty">Your infographics will appear here.</p>
    );
  }

  const startScreen = (
    <section className="iv-start" aria-labelledby="studio-start-title">
      <div className="iv-start__head">
        <span className="iv-start__eyebrow">
          <Sparkles size={14} aria-hidden="true" /> Powered by Z-Image
        </span>
        <h1 className="iv-start__title" id="studio-start-title">
          Infographic Studio
        </h1>
        <p className="iv-start__lead">
          Pick a type and a look, describe your topic below, and generate a
          ready-to-share infographic in about a minute.
        </p>
      </div>

      <div className="iv-start__section">
        <h2 className="iv-start__section-title" id="studio-type-title">
          Infographic type
        </h2>
        <div
          className="iv-layouts"
          role="radiogroup"
          aria-labelledby="studio-type-title"
        >
          {INFOGRAPHIC_LAYOUTS.map((option) => {
            const selected = option.value === layout;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`iv-layout-pill ${selected ? "is-selected" : ""}`}
                onClick={() => setLayout(option.value)}
                disabled={busy}
                title={option.description}
              >
                <Icon size={16} aria-hidden="true" />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="iv-start__section">
        <h2 className="iv-start__section-title" id="studio-style-title">
          Visual style
        </h2>
        <div
          className="iv-showcase"
          role="radiogroup"
          aria-labelledby="studio-style-title"
        >
          {INFOGRAPHIC_STYLES.map((option) => {
            const selected = option.value === style;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`iv-showcase__card ${selected ? "is-selected" : ""}`}
                onClick={() => setStyle(option.value)}
                disabled={busy}
              >
                <span className="iv-showcase__art">
                  <StylePoster style={option.value} />
                  {selected && (
                    <span className="iv-showcase__check">
                      <Check size={14} aria-hidden="true" />
                    </span>
                  )}
                </span>
                <span className="iv-showcase__name">{option.label}</span>
                <span className="iv-showcase__desc">{option.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="iv-start__examples">
        <span className="iv-start__examples-label">Try an example</span>
        {EXAMPLES.map((example) => (
          <button
            key={example.text}
            type="button"
            className="iv-example"
            onClick={() => fillExample(example)}
          >
            <span className="iv-example__type">
              {LAYOUT_LABEL[example.layout]}
            </span>
            {example.text}
            <ArrowUp size={14} aria-hidden="true" />
          </button>
        ))}
      </div>

      {feedItems.length > 0 && (
        <div className="iv-start__recent">
          <div className="iv-cs__gallery-head">
            <h2>Recent</h2>
            <Link to={ROUTES.generations} className="iv-cs__view-all">
              View all <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <div className="iv-feed">
            {feedItems.slice(0, 12).map((entry) => (
              <FeedTile
                key={entry.id}
                item={entry}
                selected={false}
                onOpen={() => open(entry)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );

  return (
    <div className="iv-cs">
      <aside className="iv-rail" aria-label="History">
        <div className="iv-rail__head">
          <span className="iv-rail__title">
            <History size={15} aria-hidden="true" /> History
          </span>
          {feed.data?.total > 0 && (
            <span className="iv-rail__count">{feed.data.total}</span>
          )}
        </div>
        <button
          type="button"
          className={`iv-rail__new ${showViewer ? "" : "is-active"}`}
          onClick={closeViewer}
        >
          <Plus size={16} aria-hidden="true" /> New infographic
        </button>
        <div className="iv-rail__scroll">{history}</div>
        {feed.data?.total > feedItems.length && (
          <Link to={ROUTES.generations} className="iv-rail__all">
            View all {feed.data.total}{" "}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </aside>

      <div className="iv-cs__main">
        <div
          className={`iv-cs__stage ${showViewer ? "is-viewer" : ""}`}
          ref={stageRef}
        >
          {showViewer ? viewer : startScreen}
        </div>

        <form
          className="iv-composer"
          onSubmit={generate}
          noValidate
          aria-label="Create an infographic"
        >
          <div className={`iv-composer__box ${topicError ? "is-invalid" : ""}`}>
            {!keyStatus.loading && !isPreview && (
              <KeyCallout keyStatus={keyStatus} />
            )}
            {submitError && (
              <div
                className="iv-composer__notice iv-composer__notice--danger"
                role="alert"
              >
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{errorMessage(submitError)}</span>
              </div>
            )}
            <label htmlFor="topic" className="visually-hidden">
              Topic or description
            </label>
            <textarea
              id="topic"
              ref={promptRef}
              className="iv-composer__prompt"
              placeholder="Describe the infographic you want — the topic and the key points to show…"
              value={topic}
              onChange={(event) => {
                setTopic(event.target.value);
                if (topicError) setTopicError(null);
              }}
              onKeyDown={onPromptKey}
              disabled={busy}
              rows={1}
              aria-invalid={topicError ? "true" : undefined}
              aria-describedby={topicError ? "topic-error" : undefined}
            />
            <div className="iv-composer__bar">
              <div className="iv-composer__chips">
                <LayoutSelect
                  value={layout}
                  onChange={setLayout}
                  disabled={busy}
                />
                <StyleSelect
                  value={style}
                  onChange={setStyle}
                  disabled={busy}
                />
                <RatioSelect
                  value={aspectRatio}
                  onChange={setAspectRatio}
                  disabled={busy}
                />
                <span
                  className="iv-chip iv-chip--static"
                  title="Model and output size"
                >
                  <Cpu size={16} className="iv-chip__icon" aria-hidden="true" />
                  <span className="iv-chip__text">
                    <span className="iv-chip__label">Model</span>
                    <span className="iv-chip__value">Z-Image · PNG</span>
                  </span>
                </span>
              </div>
              <div className="iv-composer__go">
                {keyStatus.nextSource === "credits" && (
                  <span
                    className="iv-composer__cost"
                    title={`${keyStatus.credits.credits} credits left`}
                  >
                    {keyStatus.credits.creditsPerInfographic} credits
                  </span>
                )}
                <span
                  className={`iv-composer__count ${tooLong ? "is-over" : ""}`}
                >
                  {trimmed.length}/{TOPIC_MAX}
                </span>
                <button
                  type="submit"
                  className="iv-generate-btn"
                  disabled={!canGenerate}
                  aria-busy={submitting || undefined}
                >
                  {submitting || active ? (
                    <Loader2 size={18} className="iv-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles size={18} aria-hidden="true" />
                  )}
                  <span>{active ? "Generating" : "Generate"}</span>
                </button>
              </div>
            </div>
          </div>
          {topicError && (
            <p className="iv-composer__error" id="topic-error" role="alert">
              {topicError}
            </p>
          )}
        </form>
      </div>

      <Lightbox
        open={lightbox}
        src={src}
        title={item?.title}
        downloadHref={downloadUrl(item)}
        onClose={() => setLightbox(false)}
      />
    </div>
  );
}
