import { useCallback, useEffect, useRef, useState } from 'react';
import { infographicApi } from '../services/infographicApi.js';
import { JOB_POLL_INTERVAL_MS } from '../utils/constants.js';

export const ACTIVE_STATUSES = new Set(['queued', 'processing']);

/**
 * Follow one infographic until it finishes. Returns { item, error, loading,
 * setItem, refresh }. Polling stops at a terminal status, on 401/404, or
 * when the component unmounts.
 */
export function useInfographic(id, { intervalMs = JOB_POLL_INTERVAL_MS } = {}) {
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [tick, setTick] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    if (!id) {
      setItem(null);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const poll = async () => {
      try {
        const result = await infographicApi.get(id, { signal: controller.signal });
        if (!alive) return;
        setItem(result.infographic);
        setError(null);
        setLoading(false);
        if (ACTIVE_STATUSES.has(result.infographic?.status)) timer.current = setTimeout(poll, intervalMs);
      } catch (err) {
        if (!alive) return;
        setError(err);
        setLoading(false);
        if (err?.status !== 404 && err?.status !== 401) timer.current = setTimeout(poll, intervalMs * 2);
      }
    };

    poll();
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer.current);
    };
  }, [id, intervalMs, tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  return { item, error, loading, setItem, refresh };
}
