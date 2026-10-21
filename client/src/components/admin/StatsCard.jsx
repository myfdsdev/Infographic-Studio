/**
 * One admin stat tile (label, big number, coloured icon on the right). When
 * `pending` is true the value is unknown and "Not connected" is shown instead
 * of a number; nothing is estimated.
 */
export default function StatsCard({ label, value, icon: Icon, tone, pending = false, hint, delay = 0 }) {
  return (
    <div className="iv-card iv-stat" style={{ animationDelay: `${delay}ms` }}>
      <div className="min-w-0">
        <p className="iv-stat__label">{label}</p>
        <p className={`iv-stat__value ${pending ? 'iv-stat__value--pending' : ''}`}>
          {pending ? 'Not connected' : (value ?? '-')}
        </p>
        {hint && <p className="iv-field__hint mb-0 mt-1">{hint}</p>}
      </div>
      {Icon && (
        <span className={`iv-stat__icon ${tone ? `iv-stat__icon--${tone}` : ''}`} aria-hidden="true">
          <Icon />
        </span>
      )}
    </div>
  );
}
