export default function Card({
  title,
  subtitle,
  actions,
  children,
  footer,
  pad = true,
  accent = false,
  hover = false,
  dashed = false,
  className = '',
  bodyClassName = '',
  as: Tag = 'section',
  ...rest
}) {
  const classes = ['iv-card'];
  if (accent) classes.push('iv-card--accent');
  if (hover) classes.push('iv-card--hover');
  if (dashed) classes.push('iv-card--dashed');
  if (className) classes.push(className);
  const hasHead = title || actions;

  return (
    <Tag className={classes.join(' ')} {...rest}>
      {hasHead && (
        <header className="iv-card__head">
          <div className="min-w-0">
            {title && <h2 className="iv-card__title">{title}</h2>}
            {subtitle && <p className="iv-card__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="d-flex align-items-center gap-2 flex-shrink-0">{actions}</div>}
        </header>
      )}
      <div className={`${pad ? 'iv-card__body' : ''} ${bodyClassName}`.trim()}>{children}</div>
      {footer && <footer className="iv-card__foot">{footer}</footer>}
    </Tag>
  );
}
