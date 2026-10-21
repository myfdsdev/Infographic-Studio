import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { api, API_BASE_URL } from '../services/api.js';
import { APP_NAME, APP_TAGLINE, BRANDING } from '../utils/constants.js';

export const BrandingContext = createContext(null);

const STORAGE_KEY = 'ais-branding';
const DEFAULT_ACCENT = '#7665e8';
const DEFAULTS = Object.freeze({
  appName: APP_NAME,
  tagline: APP_TAGLINE,
  accentColor: DEFAULT_ACCENT,
  logoPath: null,
  faviconPath: null,
  customLogo: false,
  customFavicon: false,
  version: 0,
});

function readCached() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeCached(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

function rgb(hex) {
  const value = /^#([0-9a-f]{6})$/i.test(hex || '') ? hex.slice(1) : DEFAULT_ACCENT.slice(1);
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}

/** Black or white text, whichever reads better on the accent (WCAG luminance). */
export function inkFor(hex) {
  const [r, g, b] = rgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.36 ? '#000000' : '#ffffff';
}

/** A darker shade of the accent for text and button fills (keeps AA contrast). */
function shade(hex, amount) {
  return `#${rgb(hex)
    .map((channel) => Math.max(0, Math.round(channel * (1 - amount))).toString(16).padStart(2, '0'))
    .join('')}`;
}

function applyTheme({ appName, accentColor, faviconUrl, customFavicon }) {
  const root = document.documentElement;
  const [r, g, b] = rgb(accentColor);
  const isDefault = accentColor.toLowerCase() === DEFAULT_ACCENT;
  // The default accent uses the hand-tuned monochrome tokens from style.css.
  const props = isDefault
    ? {}
    : {
        '--accent': accentColor,
        '--accent-strong': shade(accentColor, 0.08),
        '--accent-hover': shade(accentColor, 0.18),
        '--accent-text': shade(accentColor, 0.2),
        '--accent-soft': `rgba(${r}, ${g}, ${b}, 0.1)`,
        '--accent-ring': `rgba(${r}, ${g}, ${b}, 0.28)`,
        '--accent-ink': inkFor(shade(accentColor, 0.08)),
      };
  for (const name of ['--accent', '--accent-strong', '--accent-hover', '--accent-text', '--accent-soft', '--accent-ring', '--accent-ink']) {
    if (props[name]) root.style.setProperty(name, props[name]);
    else root.style.removeProperty(name);
  }
  document.title = appName;
  // The home-screen icon keeps its larger built-in file unless an admin set one.
  for (const link of document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')) {
    const href = link.rel === 'apple-touch-icon' && !customFavicon ? BRANDING.touchIconUrl : faviconUrl;
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }
}

/**
 * App name, tagline, logo, favicon and accent colour. Loaded from the public
 * GET /api/branding (administrators edit it under Admin > Branding); the last
 * values are kept in localStorage so the next visit starts with them. The
 * built-in defaults are "AI Infographic Studio" with the supplied logo and favicon.
 */
export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(() => ({ ...DEFAULTS, ...(readCached() || {}) }));

  const apply = useCallback((next) => {
    const value = { ...DEFAULTS, ...(next || {}) };
    setBranding(value);
    writeCached(value);
  }, []);

  const reload = useCallback(async () => {
    try {
      const result = await api.get('/branding', { timeoutMs: 8000 });
      if (result?.branding) apply(result.branding);
    } catch {
      /* keep the current (cached or default) branding */
    }
  }, [apply]);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo(
    () => ({
      appName: branding.appName || APP_NAME,
      tagline: branding.tagline ?? APP_TAGLINE,
      accentColor: branding.accentColor || DEFAULT_ACCENT,
      logoUrl: branding.logoPath ? `${API_BASE_URL}${branding.logoPath}` : BRANDING.logoUrl,
      // The wordmark spells the default name, so it is only used while both the
      // logo and the name are the built-in ones.
      wordmarkUrl: !branding.logoPath && (branding.appName || APP_NAME) === APP_NAME ? BRANDING.wordmarkUrl : null,
      faviconUrl: branding.faviconPath ? `${API_BASE_URL}${branding.faviconPath}` : BRANDING.faviconUrl,
      customLogo: Boolean(branding.customLogo),
      customFavicon: Boolean(branding.customFavicon),
      defaultLogoUrl: BRANDING.logoUrl,
      defaultFaviconUrl: BRANDING.faviconUrl,
      reload,
      apply,
    }),
    [branding, reload, apply],
  );

  useEffect(() => {
    applyTheme(value);
  }, [value]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}
