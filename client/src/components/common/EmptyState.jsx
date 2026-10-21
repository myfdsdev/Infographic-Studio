export default function EmptyState({ title, description, action, icon: Icon = null, plain = false, className = '' }) {
  return (
    <div className={`iv-state ${plain ? 'iv-state--plain' : ''} ${className}`.trim()}>
      {Icon && (
        <div className="iv-state__icon" aria-hidden="true">
          <Icon />
        </div>
      )}
      <h3 className="iv-state__title">{title}</h3>
      {description && <p className="iv-state__description">{description}</p>}
      {action && <div className="iv-state__action">{action}</div>}
    </div>
  );
}
