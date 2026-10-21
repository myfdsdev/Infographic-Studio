import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function PageHeader({ eyebrow, title, description, actions, backTo, backLabel = 'Back', children }) {
  return (
    <header className="iv-page-header">
      <div className="min-w-0">
        {backTo && (
          <Link to={backTo} className="iv-page-header__back">
            <ArrowLeft size={14} /> {backLabel}
          </Link>
        )}
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="iv-page-header__title">{title}</h1>
        {description && <p className="iv-page-header__desc">{description}</p>}
        {children}
      </div>
      {actions && <div className="iv-page-header__actions">{actions}</div>}
    </header>
  );
}
