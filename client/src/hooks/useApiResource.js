import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotImplemented } from '../services/api.js';

/**
 * Load a resource from the backend and expose the honest state of that call:
 *   loading        request in flight
 *   data           parsed response
 *   error          ApiError or network error
 *   notImplemented true when the endpoint does not exist yet (later phase)
 *
 * `fetcher` receives an AbortSignal and must return a promise.
 */
export function useApiResource(fetcher, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled, notImplemented: false });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState((prev) => ({ ...prev, loading: false }));
      return undefined;
    }
    const controller = new AbortController();
    let alive = true;
    setState((prev) => ({ ...prev, loading: true, error: null, notImplemented: false }));

    Promise.resolve()
      .then(() => fetcherRef.current(controller.signal))
      .then((data) => {
        if (alive) setState({ data, error: null, loading: false, notImplemented: false });
      })
      .catch((error) => {
        if (!alive || error?.name === 'AbortError') return;
        setState({ data: null, error, loading: false, notImplemented: isNotImplemented(error) });
      });

    return () => {
      alive = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tick, ...deps]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  const setData = useCallback((updater) => {
    setState((prev) => ({ ...prev, data: typeof updater === 'function' ? updater(prev.data) : updater }));
  }, []);

  return { ...state, reload, setData };
}
