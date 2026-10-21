import { Link } from 'react-router-dom';
import Loader from './Loader.jsx';

const VARIANT_CLASS = {
  primary: 'btn-iv-primary',
  secondary: 'btn-iv-secondary',
  ghost: 'btn-iv-ghost',
  danger: 'btn-iv-danger',
  link: 'btn-iv-link',
  white: 'btn-iv-white',
  glass: 'btn-iv-glass',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  iconOnly = false,
  loading = false,
  disabled = false,
  block = false,
  type = 'button',
  to,
  href,
  className = '',
  children,
  ...rest
}) {
  const classes = ['btn', VARIANT_CLASS[variant] || VARIANT_CLASS.primary];
  if (size === 'sm') classes.push('btn-sm');
  if (size === 'lg') classes.push('btn-lg');
  if (iconOnly) classes.push('btn-iv-icon');
  if (block) classes.push('btn-block');
  if (className) classes.push(className);

  const iconSize = size === 'sm' ? 14 : 16;
  const content = (
    <>
      {loading ? <Loader size="sm" inline /> : Icon ? <Icon size={iconSize} aria-hidden="true" /> : null}
      {!iconOnly && children !== undefined && <span>{children}</span>}
      {!loading && IconRight ? <IconRight size={iconSize} aria-hidden="true" /> : null}
    </>
  );

  if (to && !disabled) {
    return (
      <Link to={to} className={classes.join(' ')} {...rest}>
        {content}
      </Link>
    );
  }
  if (href && !disabled) {
    return (
      <a href={href} className={classes.join(' ')} target="_blank" rel="noopener noreferrer" {...rest}>
        {content}
      </a>
    );
  }
  return (
    <button type={type} className={classes.join(' ')} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {content}
    </button>
  );
}
