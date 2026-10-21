import { createContext, useCallback, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export const ToastContext = createContext(null);

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (type, message, { duration = 4200 } = {}) => {
      const id = ++counter.current;
      setToasts((list) => [...list.slice(-4), { id, type, message }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      toast: {
        success: (message, options) => push('success', message, options),
        error: (message, options) => push('error', message, { duration: 6000, ...options }),
        info: (message, options) => push('info', message, options),
      },
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="iv-toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type] || Info;
          return (
            <div key={toast.id} className={`iv-toast iv-toast--${toast.type}`} role="status">
              <Icon aria-hidden="true" />
              <span>{toast.message}</span>
              <button type="button" className="iv-toast__close" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
