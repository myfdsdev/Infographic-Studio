export default function Tabs({ tabs = [], value, onChange, ariaLabel = 'Tabs', className = '' }) {
  return (
    <div className={`iv-tabs ${className}`.trim()} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={`iv-tab ${active ? 'is-active' : ''}`}
            onClick={() => onChange?.(tab.key)}
            disabled={tab.disabled}
          >
            {Icon && <Icon aria-hidden="true" />}
            {tab.label}
            {typeof tab.count === 'number' && <span className="iv-tab__count">({tab.count})</span>}
          </button>
        );
      })}
    </div>
  );
}
