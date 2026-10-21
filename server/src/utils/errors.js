// Application error types. Every error that reaches the client passes through
// middleware/errorHandler.js, which turns these into a consistent JSON shape:
//   { error: { code, message, details?, requestId } }

export class AppError extends Error {
  constructor(
    message,
    { statusCode = 500, code = 'INTERNAL_ERROR', details = undefined, cause = undefined } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details) {
    super(message, { statusCode: 400, code: 'VALIDATION_ERROR', details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, { statusCode: 401, code: 'UNAUTHORIZED' });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that') {
    super(message, { statusCode: 403, code: 'FORBIDDEN' });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, { statusCode: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details) {
    super(message, { statusCode: 409, code: 'CONFLICT', details });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests, please slow down') {
    super(message, { statusCode: 429, code: 'RATE_LIMITED' });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', details) {
    super(message, { statusCode: 503, code: 'SERVICE_UNAVAILABLE', details });
  }
}

export function isAppError(err) {
  return err instanceof AppError;
}
