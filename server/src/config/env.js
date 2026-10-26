// Environment loading and validation for the AI Infographic Studio API.
//
// Every variable the server reads is declared here with its type, default and
// constraints. The process refuses to start (or `npm run check:env` reports)
// when a required value is missing, so misconfiguration is caught up front
// instead of surfacing as a confusing runtime failure.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Load server/.env when present. Real deployments set variables in the host
// environment; dotenv never overrides values that already exist.
dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true });

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  });

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

const optionalBoolean = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    if (value.trim() === '') return undefined;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  });

const csvList = z
  .string()
  .optional()
  .transform((value) =>
    (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    CLIENT_URL: z.string().url().default('http://localhost:5173'),
    SERVER_URL: z.string().url().default('http://localhost:5000'),
    CORS_ORIGINS: csvList,
    SERVE_CLIENT: booleanFromString.default(false),

    MONGODB_URI: z
      .string()
      .min(1, 'MONGODB_URI is required')
      .refine(
        (value) => /^mongodb(\+srv)?:\/\//.test(value),
        'MONGODB_URI must start with mongodb:// or mongodb+srv://',
      ),
    // Used when the URI does not name a database (Atlas copy-paste URIs often don't).
    MONGODB_DB_NAME: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,63}$/, 'MONGODB_DB_NAME may only contain letters, digits, _ and -')
        .default('ai_infographic_studio'),
    ),
    MONGODB_RETRY_SECONDS: z.coerce.number().int().min(1).default(15),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)'),

    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    SESSION_SHORT_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    COOKIE_SECURE: optionalBoolean,
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    COOKIE_DOMAIN: optionalString,
    SIGNUP_ENABLED: booleanFromString.default(true),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    // The app refuses to write into a bucket that already holds another
    // application's files (separate storage is a hard project rule). Set to
    // true only if sharing a bucket is a deliberate decision.
    STORAGE_ALLOW_SHARED_BUCKET: booleanFromString.default(false),
    // Optional folder inside the bucket, e.g. "prod/" or "staging/", so
    // several environments can share one bucket without mixing files.
    STORAGE_KEY_PREFIX: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .regex(/^[a-z0-9][a-z0-9_-]{0,40}\/$/, 'STORAGE_KEY_PREFIX must be lowercase letters, digits, - or _ and end with /')
        .optional(),
    ),
    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_PUBLIC_BASE_URL: optionalString,

    // console = write emails to the server log (development only)
    // smtp    = deliver through SMTP_* below
    // memory  = keep emails in process memory (automated tests only)
    EMAIL_PROVIDER: z.enum(['console', 'smtp', 'memory']).default('console'),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: booleanFromString.default(false),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    EMAIL_FROM: z.string().default('AI Infographic Studio <no-reply@example.com>'),

    // ---- Sign in with Google (optional) -----------------------------------
    // An OAuth client of type "Web application" from Google Cloud Console.
    // With both set, "Continue with Google" appears on the sign-in pages. The
    // redirect URI to register there is CLIENT_URL + /api/auth/google/callback
    // (or GOOGLE_REDIRECT_URI when the API is reached on another address).
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GOOGLE_REDIRECT_URI: optionalString,
    // Google's endpoints. Only tests point these at a local stand-in.
    GOOGLE_AUTH_URL: z.string().url().default('https://accounts.google.com/o/oauth2/v2/auth'),
    GOOGLE_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),
    GOOGLE_JWKS_URL: z.string().url().default('https://www.googleapis.com/oauth2/v3/certs'),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(1000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
    LOGIN_EMAIL_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),

    // ---- provider (Kie.ai) -------------------------------------------------
    KIE_API_BASE_URL: z.string().url().default('https://api.kie.ai'),
    PROVIDER_SUBMIT_TIMEOUT_MS: z.coerce.number().int().min(100).default(30000),
    PROVIDER_STATUS_TIMEOUT_MS: z.coerce.number().int().min(100).default(15000),
    // Public https base URL of this API. When set, providers are asked to call
    // back to it; callbacks also let uncertain submissions be reconciled.
    PUBLIC_WEBHOOK_BASE_URL: optionalString,
    // Kie.ai File Upload API host (docs.kie.ai/file-upload-api). Reference
    // images referenced by a job (none for text-only infographics) go here with the user's own
    // key; Kie.ai deletes them after 24 hours. Uploads are free per the docs.
    KIE_UPLOAD_BASE_URL: z.string().url().default('https://kieai.redpandaai.co'),

    // ---- uploads (branding images) and stored images ---------------------
    UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(50).default(10),
    // Largest generated image accepted when a finished infographic is saved.
    ASSET_DOWNLOAD_MAX_MB: z.coerce.number().int().min(1).max(200).default(30),

    // ---- MCP server and OAuth ------------------------------------------------
    // The MCP endpoint is SERVER_URL + /mcp; SERVER_URL is also the OAuth issuer.
    MCP_ENABLED: booleanFromString.default(true),
    OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(3600),
    OAUTH_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    // Client registration: Client ID Metadata Documents (preferred by the MCP
    // spec, Claude and ChatGPT) and Dynamic Client Registration (fallback).
    OAUTH_CIMD_ENABLED: booleanFromString.default(true),
    OAUTH_DCR_ENABLED: booleanFromString.default(true),
    MCP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(100000).default(120),

    // ---- background jobs -----------------------------------------------------
    WORKER_ENABLED: booleanFromString.default(true),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
    JOB_USER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
    // How often the worker looks for due jobs.
    JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(10).default(2000),
    // Submission attempts for errors where the provider certainly did NOT create a task.
    JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    JOB_RETRY_BASE_MS: z.coerce.number().int().min(1).default(15000),
    JOB_POLL_MIN_MS: z.coerce.number().int().min(1).default(4000),
    JOB_POLL_MAX_MS: z.coerce.number().int().min(1).default(30000),
    JOB_LEASE_MS: z.coerce.number().int().min(1000).default(90000),
    JOB_IMAGE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).default(15),
    JOB_RECONCILE_MINUTES: z.coerce.number().int().min(1).default(15),
    JOB_CREATE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),

    ADMIN_EMAIL: optionalString,
    ADMIN_PASSWORD: optionalString,
  })
  .superRefine((value, ctx) => {
    if (value.STORAGE_DRIVER === 's3') {
      // No public URL is needed: files are private and served by the API.
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
        if (!value[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when STORAGE_DRIVER=s3` });
        }
      }
      // Sharing a bucket is only allowed with the app confined to its own folder.
      if (value.STORAGE_ALLOW_SHARED_BUCKET && !value.STORAGE_KEY_PREFIX) {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_KEY_PREFIX'],
          message: 'STORAGE_KEY_PREFIX (for example infographic-studio/) is required when STORAGE_ALLOW_SHARED_BUCKET=true',
        });
      }
    }
    if (value.EMAIL_PROVIDER === 'smtp' && !value.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'SMTP_HOST is required when EMAIL_PROVIDER=smtp' });
    }
    if (value.EMAIL_PROVIDER === 'memory' && value.NODE_ENV !== 'test') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'EMAIL_PROVIDER=memory is only allowed when NODE_ENV=test' });
    }
    if (value.NODE_ENV === 'production') {
      if (value.STORAGE_DRIVER === 'local') {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_DRIVER'],
          message: 'STORAGE_DRIVER=local is for development only; use s3 in production',
        });
      }
      if (value.EMAIL_PROVIDER !== 'smtp') {
        ctx.addIssue({
          code: 'custom',
          path: ['EMAIL_PROVIDER'],
          message: 'EMAIL_PROVIDER must be smtp in production (console would write password-reset links to logs)',
        });
      }
      if (value.COOKIE_SECURE === false) {
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'COOKIE_SECURE cannot be false in production' });
      }
    }
    if (value.NODE_ENV === 'production' && value.MCP_ENABLED && !value.SERVER_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['SERVER_URL'],
        message: 'SERVER_URL must use https in production: it is the OAuth issuer and MCP URL (or set MCP_ENABLED=false)',
      });
    }
    if (value.NODE_ENV === 'production') {
      for (const key of ['KIE_API_BASE_URL', 'KIE_UPLOAD_BASE_URL', 'PUBLIC_WEBHOOK_BASE_URL']) {
        if (value[key] && !String(value[key]).startsWith('https://')) {
          ctx.addIssue({ code: 'custom', path: [key], message: `${key} must use https in production` });
        }
      }
    }
    if (Boolean(value.GOOGLE_CLIENT_ID) !== Boolean(value.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: [value.GOOGLE_CLIENT_ID ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID'],
        message: 'Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for Sign in with Google, or neither',
      });
    }
    if (value.GOOGLE_REDIRECT_URI && !/^https?:\/\/[^/]+\/.+\/auth\/google\/callback$/.test(value.GOOGLE_REDIRECT_URI)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_REDIRECT_URI'],
        message: 'GOOGLE_REDIRECT_URI must be a full URL ending in /auth/google/callback',
      });
    }
    if (value.NODE_ENV === 'production') {
      for (const key of ['GOOGLE_AUTH_URL', 'GOOGLE_TOKEN_URL', 'GOOGLE_JWKS_URL', 'GOOGLE_REDIRECT_URI']) {
        if (value[key] && !String(value[key]).startsWith('https://')) {
          ctx.addIssue({ code: 'custom', path: [key], message: `${key} must use https in production` });
        }
      }
    }
    if (value.JOB_POLL_MIN_MS > value.JOB_POLL_MAX_MS) {
      ctx.addIssue({ code: 'custom', path: ['JOB_POLL_MIN_MS'], message: 'JOB_POLL_MIN_MS cannot exceed JOB_POLL_MAX_MS' });
    }
    if (value.COOKIE_SAMESITE === 'none' && value.COOKIE_SECURE === false) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SAMESITE'], message: 'COOKIE_SAMESITE=none requires secure cookies' });
    }
  });

export class EnvValidationError extends Error {
  constructor(issues) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

function formatIssues(error) {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

/** The database name in the URI path, if any (e.g. mongodb://host/name?x=y -> "name"). */
export function databaseNameFromUri(uri) {
  const match = String(uri).match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/);
  const name = match ? decodeURIComponent(match[1]).trim() : '';
  return name || null;
}

/**
 * Parse and validate an environment object. Throws EnvValidationError when any
 * required value is missing or malformed.
 */
export function loadEnv(source = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvValidationError(formatIssues(parsed.error));
  }
  const value = parsed.data;
  const isProduction = value.NODE_ENV === 'production';
  const cookieSecure = value.COOKIE_SECURE ?? (isProduction || value.COOKIE_SAMESITE === 'none');
  return Object.freeze({
    ...value,
    serverRoot,
    isProduction,
    isDevelopment: value.NODE_ENV === 'development',
    isTest: value.NODE_ENV === 'test',
    storageLocalDir: path.resolve(serverRoot, value.STORAGE_LOCAL_DIR),
    databaseName: databaseNameFromUri(value.MONGODB_URI) || value.MONGODB_DB_NAME,
    cookieSecure,
    googleEnabled: Boolean(value.GOOGLE_CLIENT_ID && value.GOOGLE_CLIENT_SECRET),
    googleRedirectUri: value.GOOGLE_REDIRECT_URI || `${value.CLIENT_URL.replace(/\/+$/, '')}/api/auth/google/callback`,
    // OAuth issuer (no trailing slash) and the MCP resource identifier
    // (RFC 8707 / RFC 9728): exactly the URL users paste into their AI client.
    oauthIssuer: value.SERVER_URL.replace(/\/+$/, ''),
    mcpResourceUrl: `${value.SERVER_URL.replace(/\/+$/, '')}/mcp`,
  });
}

function redactUri(uri) {
  return String(uri).replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@');
}

// `node src/config/env.js --check` prints a human-readable report instead of
// throwing, so operators can validate a deployment before starting it.
const invokedDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly && process.argv.includes('--check')) {
  try {
    const checked = loadEnv(process.env);
    console.log('Environment OK');
    console.log(`  NODE_ENV=${checked.NODE_ENV} PORT=${checked.PORT} HOST=${checked.HOST}`);
    console.log(`  MONGODB_URI=${redactUri(checked.MONGODB_URI)} (database: ${checked.databaseName})`);
    console.log(`  STORAGE_DRIVER=${checked.STORAGE_DRIVER} EMAIL_PROVIDER=${checked.EMAIL_PROVIDER}`);
    console.log(`  cookies: secure=${checked.cookieSecure} sameSite=${checked.COOKIE_SAMESITE} signup=${checked.SIGNUP_ENABLED}`);
    process.exit(0);
  } catch (error) {
    console.error('Environment is NOT valid:');
    for (const issue of error.issues || [error.message]) console.error(`  - ${issue}`);
    console.error('\nSee server/.env.example for every variable and how to generate secrets.');
    process.exit(1);
  }
}

export const env = invokedDirectly ? undefined : loadEnv();
