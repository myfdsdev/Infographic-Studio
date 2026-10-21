import { useEffect, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';

function clock(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The "being generated" state: a frame in the shape of the result with a
 * moving shimmer, the current step and the time since it started. It only
 * shows what the server reports (step names and statuses); nothing is faked.
 *
 *   steps: [{ label, status: 'pending' | 'running' | 'completed' | 'failed' }]
 */
export default function GeneratingLoader({ aspectRatio = '9:16', title = 'Generating', detail, startedAt, steps = [], compact = false, maxHeight: maxHeightProp }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [w, h] = String(aspectRatio).split(':').map(Number);
  const [width, height] = w && h ? [w, h] : [9, 16];
  // As tall as the screen allows, never wider than the panel.
  const maxHeight = maxHeightProp || (compact ? '300px' : 'min(68vh, 620px)');
  const seconds = startedAt ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000)) : null;
  const running = steps.find((step) => step.status === 'running');

  const frameWidth = `min(100%, calc(${maxHeight} * ${width / height}))`;

  return (
    <div className={`iv-generating ${compact ? 'iv-generating--compact' : ''}`} role="status" aria-live="polite">
      <div className="iv-generating__frame" style={{ aspectRatio: `${width} / ${height}`, width: frameWidth }}>
        <div className="iv-generating__shimmer" aria-hidden="true" />
        <div className="iv-generating__center">
          <span className="iv-generating__orb" aria-hidden="true">
            <Sparkles size={compact ? 18 : 22} />
          </span>
          <strong className="iv-generating__title">{title}</strong>
          {(running?.label || detail) && <span className="iv-generating__detail">{running?.label || detail}</span>}
          {seconds !== null && <span className="iv-generating__time">{clock(seconds)}</span>}
        </div>
      </div>
      {steps.length > 1 && (
        <ol className="iv-generating__steps" aria-label="Steps" style={{ width: `max(240px, ${frameWidth})` }}>
          {steps.map((step) => (
            <li key={step.label} className={`is-${step.status}`}>
              <span className="iv-generating__dot" aria-hidden="true">
                {step.status === 'completed' ? <Check size={10} /> : null}
              </span>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
