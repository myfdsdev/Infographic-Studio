import { useContext } from 'react';
import { KeyStatusContext } from '../context/KeyStatusContext.jsx';

export function useKeyStatus() {
  const context = useContext(KeyStatusContext);
  if (!context) throw new Error('useKeyStatus must be used inside KeyStatusProvider');
  return context;
}
