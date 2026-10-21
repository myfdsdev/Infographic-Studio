const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

export function isEmail(value) {
  return EMAIL_RE.test(String(value || '').trim());
}

export function isUrl(value) {
  return URL_RE.test(String(value || '').trim());
}

export function required(value, label = 'This field') {
  if (value === undefined || value === null || String(value).trim() === '') return `${label} is required`;
  return null;
}

export function validateEmail(value) {
  if (!String(value || '').trim()) return 'Email is required';
  if (!isEmail(value)) return 'Enter a valid email address';
  return null;
}

export function validatePassword(value, { min = 8 } = {}) {
  const password = String(value || '');
  if (!password) return 'Password is required';
  if (password.length < min) return `Password must be at least ${min} characters`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use at least one letter and one number';
  return null;
}

export function validatePasswordMatch(password, confirm) {
  if (!confirm) return 'Please confirm your password';
  if (password !== confirm) return 'Passwords do not match';
  return null;
}

export function validateName(value) {
  const name = String(value || '').trim();
  if (!name) return 'Name is required';
  if (name.length < 2) return 'Name is too short';
  if (name.length > 80) return 'Name is too long';
  return null;
}

export function validateApiKey(value) {
  const key = String(value || '').trim();
  if (!key) return 'API key is required';
  if (key.length < 16) return 'That does not look like a full API key';
  if (/\s/.test(key)) return 'API keys cannot contain spaces';
  return null;
}

export function validateMaxLength(value, max, label = 'This field') {
  if (String(value || '').length > max) return `${label} must be ${max} characters or fewer`;
  return null;
}

/**
 * Run a map of field -> validator(value, values) and return { errors, valid }.
 */
export function validateForm(values, rules) {
  const errors = {};
  for (const [field, rule] of Object.entries(rules)) {
    const message = rule(values[field], values);
    if (message) errors[field] = message;
  }
  return { errors, valid: Object.keys(errors).length === 0 };
}

export function isImageFile(file) {
  return Boolean(file && file.type && file.type.startsWith('image/'));
}

export function isWithinSize(file, maxMb) {
  return Boolean(file && file.size <= maxMb * 1024 * 1024);
}
