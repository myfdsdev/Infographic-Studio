// Last-line redaction for text shown to administrators (provider error
// messages, operational log lines). Structured secrets are already removed by
// the logger and scrubSecrets; this masks anything secret-looking that ended
// up inside free text.

const PATTERNS = [
  // Authorization headers and bearer values
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  // key=value / key: value pairs whose name says secret
  [/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization|signature|client[_-]?secret)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi, '$1$2[redacted]'],
  // Query strings carry signed URLs and capability tokens
  [/(https?:\/\/[^\s?#"']+)\?[^\s"']+/gi, '$1?[redacted]'],
  // Long opaque strings (keys, tokens, hashes); 24-hex Mongo ids stay visible
  [/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]'],
];

export function redactText(value, maxLength = 500) {
  if (value === null || value === undefined) return value;
  let text = String(value);
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

/** Deep copy with every string passed through redactText (depth- and size-limited). */
export function redactDeep(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactDeep(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value).slice(0, 30)) {
      if (/pass|secret|token|apikey|api_key|authorization|cookie|encrypted/i.test(key)) continue;
      out[key] = redactDeep(inner, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, 100);
}
