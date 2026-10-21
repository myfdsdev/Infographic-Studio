import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { settingsApi } from '../services/settingsApi.js';
import { useAuth } from '../hooks/useAuth.js';
import { PROVIDER } from '../utils/constants.js';

export const KeyStatusContext = createContext(null);

/**
 * The signed-in user's own Kie.ai key status (masked: status and last four
 * characters only; the key itself never reaches the browser). Shared by the
 * top header, the generator and API Settings so they stay in step.
 */
export function KeyStatusProvider({ children }) {
  const { isPreview, user } = useAuth();
  const [state, setState] = useState({ credential: null, loading: true, error: null });

  const reload = useCallback(async () => {
    if (isPreview) {
      setState({ credential: null, loading: false, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const result = await settingsApi.listCredentials();
      const credential = (result?.items || []).find((item) => item.provider === PROVIDER.key) || null;
      setState({ credential, loading: false, error: null });
    } catch (error) {
      setState({ credential: null, loading: false, error });
    }
  }, [isPreview]);

  useEffect(() => {
    reload();
  }, [reload, user?.id]);

  const setCredential = useCallback((credential) => setState({ credential, loading: false, error: null }), []);

  const value = useMemo(() => {
    const { credential } = state;
    // 'unverified' means Kie.ai could not be reached when it was saved; the
    // server still accepts it, so it is usable but labelled as unchecked.
    let status = 'missing';
    if (credential?.status === 'invalid') status = 'invalid';
    else if (credential?.status === 'unverified') status = 'unverified';
    else if (credential) status = 'connected';
    return { ...state, status, usable: status === 'connected' || status === 'unverified', reload, setCredential };
  }, [state, reload, setCredential]);

  return <KeyStatusContext.Provider value={value}>{children}</KeyStatusContext.Provider>;
}
