import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { settingsApi } from '../services/settingsApi.js';
import { useAuth } from '../hooks/useAuth.js';
import { PROVIDER } from '../utils/constants.js';

export const KeyStatusContext = createContext(null);

/**
 * How the signed-in user can generate: platform credits (spent first) and
 * their own Kie.ai key (masked: status and last four characters only; the key
 * itself never reaches the browser). Shared by the top header, the generator
 * and API Settings so they stay in step.
 */
export function KeyStatusProvider({ children }) {
  const { isPreview, user } = useAuth();
  const [state, setState] = useState({ credential: null, credits: null, loading: true, error: null });

  const reload = useCallback(async () => {
    if (isPreview) {
      setState({ credential: null, credits: null, loading: false, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const [result, credits] = await Promise.all([
        settingsApi.listCredentials(),
        settingsApi.getCredits().catch(() => null),
      ]);
      const credential = (result?.items || []).find((item) => item.provider === PROVIDER.key) || null;
      setState({ credential, credits, loading: false, error: null });
    } catch (error) {
      setState({ credential: null, credits: null, loading: false, error });
    }
  }, [isPreview]);

  useEffect(() => {
    reload();
  }, [reload, user?.id]);

  // A saved or removed key changes what pays next, so credits are re-read too.
  const setCredential = useCallback(
    (credential) => {
      setState((prev) => ({ ...prev, credential, loading: false, error: null }));
      settingsApi
        .getCredits()
        .then((credits) => setState((prev) => ({ ...prev, credits })))
        .catch(() => {});
    },
    [],
  );

  const value = useMemo(() => {
    const { credential } = state;
    // 'unverified' means Kie.ai could not be reached when it was saved; the
    // server still accepts it, so it is usable but labelled as unchecked.
    let status = 'missing';
    if (credential?.status === 'invalid') status = 'invalid';
    else if (credential?.status === 'unverified') status = 'unverified';
    else if (credential) status = 'connected';
    const keyUsable = status === 'connected' || status === 'unverified';
    // 'credits', 'own_key' or null: what the next generation is paid with.
    const nextSource = state.credits ? state.credits.nextSource : keyUsable ? 'own_key' : null;
    return { ...state, status, keyUsable, nextSource, usable: Boolean(nextSource), reload, setCredential };
  }, [state, reload, setCredential]);

  return <KeyStatusContext.Provider value={value}>{children}</KeyStatusContext.Provider>;
}
