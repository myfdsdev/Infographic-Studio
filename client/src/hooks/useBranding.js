import { useContext } from 'react';
import { BrandingContext } from '../context/BrandingContext.jsx';

export function useBranding() {
  const value = useContext(BrandingContext);
  if (!value) {
    throw new Error('useBranding must be used inside a BrandingProvider');
  }
  return value;
}
