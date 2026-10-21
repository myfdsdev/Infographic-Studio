import { titleCase } from '../../utils/formatters.js';

export default function Badge({ tone = 'neutral', dot = false, className = '', children, ...rest }) {
  const classes = ['iv-badge'];
  if (tone && tone !== 'neutral') classes.push(`iv-badge--${tone}`);
  if (dot) classes.push('iv-badge--dot');
  if (className) classes.push(className);
  return (
    <span className={classes.join(' ')} {...rest}>
      {children}
    </span>
  );
}

/** Status badge driven by a status map such as JOB_STATUSES. */
export function StatusBadge({ status, map = {}, className = '' }) {
  const entry = map[status] || { label: titleCase(status || 'unknown'), tone: 'neutral' };
  return (
    <Badge tone={entry.tone} dot className={className}>
      {entry.label}
    </Badge>
  );
}
