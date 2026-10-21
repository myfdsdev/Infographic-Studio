export default function Loader({ size = 'md', inline = false, label = 'Loading', className = '' }) {
  const sizeClass = size === 'sm' ? 'spinner-border-sm' : '';
  const spinner = (
    <span className={`spinner-border ${sizeClass} iv-spinner ${className}`.trim()} role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
    </span>
  );
  if (inline) return spinner;
  return (
    <div className="iv-loader">
      {spinner}
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%', className = '', style }) {
  return <div className={`iv-skeleton ${className}`.trim()} style={{ height, width, ...style }} aria-hidden="true" />;
}
