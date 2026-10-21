const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for HTML element content and quoted attributes. */
export function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}
