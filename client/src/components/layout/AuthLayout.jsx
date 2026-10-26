import { Link } from 'react-router-dom';
import { Sparkles, KeyRound, Plug } from 'lucide-react';
import { useBranding } from '../../hooks/useBranding.js';
import BrandMark from './BrandMark.jsx';
import { ROUTES, APP_TAGLINE } from '../../utils/constants.js';

/**
 * Shared wrapper for sign-in, sign-up, password and consent pages: a calm
 * product panel on the left (hidden on small screens) and the form on white.
 */
export default function AuthLayout({ title, subtitle, children, footer, wide = false }) {
  const { appName, tagline } = useBranding();
  return (
    <div className="iv-auth">
      <aside className="iv-auth__aside" aria-hidden="true">
        <span className="iv-auth__brand">
          <BrandMark base="iv-auth__brand" />
        </span>
        <div className="iv-auth__pitch">
          <h2>
            Turn any topic into a <em>clear, professional</em> infographic.
          </h2>
          <p>{tagline && tagline !== APP_TAGLINE ? tagline : 'Describe it, pick a style and a shape, and download a ready-to-share image.'}</p>
          <ul className="iv-auth__features">
            <li>
              <span>
                <Sparkles size={16} />
              </span>
              9 infographic types and 9 visual styles in 1:1, 3:4 and 9:16
            </li>
            <li>
              <span>
                <KeyRound size={16} />
              </span>
              Runs on your own Kie.ai key, encrypted and never shared
            </li>
            <li>
              <span>
                <Plug size={16} />
              </span>
              Generate from Claude and other assistants over MCP
            </li>
          </ul>
        </div>
        <div className="iv-auth__mock">
          <span />
          <span />
          <span />
          <div>
            <i />
            <i />
            <i />
          </div>
        </div>
      </aside>

      <main className="iv-auth__main">
        <div className={`iv-auth__card ${wide ? 'iv-auth__card--wide' : ''}`}>
          <Link to={ROUTES.login} className="iv-auth__brand iv-auth__mobile-brand" aria-label={appName}>
            <BrandMark base="iv-auth__brand" />
          </Link>
          <h1 className="iv-auth__title">{title}</h1>
          {subtitle && <p className="iv-auth__subtitle">{subtitle}</p>}
          <div className="iv-auth__body">{children}</div>
          {footer && <div className="iv-auth__footer">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
