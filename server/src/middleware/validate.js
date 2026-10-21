// Request validation with zod. Parsed values are placed on req.validated
// (Express 5 makes req.query read-only, so nothing is written back to it).
import { ValidationError } from '../utils/errors.js';

function issuesToDetails(issues) {
  const details = {};
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
      for (const key of issue.keys) details[[...issue.path, key].join('.')] = 'This field is not allowed';
      continue;
    }
    const key = issue.path.join('.') || '_';
    if (!details[key]) details[key] = issue.message;
  }
  return details;
}

/**
 * validate({ body, query, params }) where each value is a zod schema.
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const validated = {};
    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;
      const input = part === 'body' ? (req.body ?? {}) : req[part];
      const result = schema.safeParse(input);
      if (!result.success) {
        const details = issuesToDetails(result.error.issues);
        const first = Object.values(details)[0];
        return next(new ValidationError(first || 'Validation failed', details));
      }
      validated[part] = result.data;
    }
    req.validated = validated;
    return next();
  };
}
