export function formatUptime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  if (days || hours || minutes) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

export function formatDateTime(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDate(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' }).format(date);
}

export function formatRelative(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const suffix = diff >= 0 ? 'ago' : 'from now';
  if (abs < minute) return 'just now';
  if (abs < hour) return `${Math.round(abs / minute)} min ${suffix}`;
  if (abs < day) return `${Math.round(abs / hour)} h ${suffix}`;
  if (abs < 7 * day) return `${Math.round(abs / day)} d ${suffix}`;
  return formatDate(date);
}

export function formatLatency(ms) {
  if (ms === null || ms === undefined) return '-';
  const value = Number(ms);
  if (!Number.isFinite(value)) return '-';
  return value < 1 ? '<1 ms' : `${Math.round(value)} ms`;
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '-';
  if (value < 60) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  const secs = Math.round(value % 60);
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function initialsOf(nameOrEmail) {
  const source = String(nameOrEmail || '').trim();
  if (!source) return 'U';
  const base = source.includes('@') ? source.split('@')[0] : source;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0].toUpperCase());
  return letters.join('') || 'U';
}

export function displayNameOf(user) {
  if (!user) return 'User';
  if (user.name) return user.name;
  if (user.fullName) return user.fullName;
  if (user.email) {
    const prefix = user.email.split('@')[0];
    return prefix
      .split(/[._-]/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  return 'User';
}

export function truncate(text, max = 80) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}...` : value;
}

export function maskKey(last4) {
  return last4 ? `**** **** **** ${last4}` : '**** **** **** ****';
}

export function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
