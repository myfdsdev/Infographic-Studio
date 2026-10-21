// MCP tools. Every tool runs as the user the access token belongs to and
// calls the same infographic service as the dashboard, so ownership checks,
// validation, duplicate protection and strict BYOK are identical. Provider
// keys never leave the server; results contain ids, statuses, image details
// and links to the web app (stored files need the user's browser session).
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { McpConnection } from '../models/McpConnection.js';
import { ApiCredential } from '../models/ApiCredential.js';
import * as infographicService from '../services/infographic.service.js';
import { loadActiveUser } from '../services/auth.service.js';
import { assertGenerationAllowed } from '../services/platformSettings.service.js';
import { recordAudit } from '../services/audit.service.js';
import { INFOGRAPHIC_STYLES, INFOGRAPHIC_RATIOS } from '../models/Infographic.js';
import { TOPIC_MIN, TOPIC_MAX } from '../services/infographicPrompt.js';
import { AppError } from '../utils/errors.js';
import { toolByName } from './toolCatalog.js';

const objectId = (what) => z.string().regex(/^[a-f0-9]{24}$/i, `${what} must be a 24-character AI Infographic Studio id`);
const PAID_NOTE =
  'Paid: this starts generation on the user\'s own Kie.ai account and uses their Kie.ai credits (Kie.ai sets the price; AI Infographic Studio adds no charge). Only call it after the user has agreed.';

function webUrl(path) {
  return new URL(path, env.CLIENT_URL).toString();
}

function hasScopes(auth, needed, any = false) {
  const granted = new Set(auth?.scopes || []);
  return any ? needed.some((scope) => granted.has(scope)) : needed.every((scope) => granted.has(scope));
}

class ToolError extends Error {
  constructor(message, code = 'TOOL_ERROR') {
    super(message);
    this.code = code;
  }
}

function requireScope(auth, scope) {
  if (!hasScopes(auth, [scope])) {
    throw new ToolError(`This connection was not given the "${scope}" permission. Reconnect the app and allow it on the AI Infographic Studio consent page.`, 'INSUFFICIENT_SCOPE');
  }
}

// ---------------------------------------------------------------- audit

const TEXT_FIELDS = new Set(['topic', 'prompt', 'title']);

/** Tool arguments for the audit log: ids and choices kept, free text reduced to its length. */
export function sanitizeArgs(args) {
  const out = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (TEXT_FIELDS.has(key) && typeof value === 'string') out[key] = `[text, ${value.length} chars]`;
    else if (typeof value === 'string') out[key] = value.slice(0, 80);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) out[key] = value;
    else out[key] = '[omitted]';
  }
  return out;
}

async function touchConnection(auth, toolName) {
  const connectionId = auth?.extra?.connectionId;
  if (!connectionId) return;
  await McpConnection.updateOne({ _id: connectionId }, { $set: { lastUsedAt: new Date(), lastTool: toolName } }).catch(() => {});
}

function textResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
}

function errorResult(message, code) {
  return { content: [{ type: 'text', text: `${message}${code ? ` (${code})` : ''}` }], structuredContent: { error: { code: code || 'ERROR', message } }, isError: true };
}

/**
 * Run one tool call: resolve the user, check the scope again (defence in
 * depth behind the SDK's scope challenge), call the service, audit the call
 * with sanitized arguments, and turn known errors into tool errors.
 */
function runner(auth, requestMeta) {
  return (name, handler) => async (args) => {
    const tool = toolByName(name);
    const started = Date.now();
    let user = null;
    let outcome = 'success';
    let errorCode = null;
    let target = null;
    try {
      if (!auth?.extra?.userId) throw new ToolError('Not authenticated', 'UNAUTHENTICATED');
      user = await loadActiveUser(auth.extra.userId);
      if (!tool.scopeByPurpose && !hasScopes(auth, tool.scopes, tool.anyScope)) {
        throw new ToolError(`This connection is missing the permission for ${name}. Reconnect the app and allow it on the AI Infographic Studio consent page.`, 'INSUFFICIENT_SCOPE');
      }
      const { payload, target: auditTarget } = await handler(user, args);
      target = auditTarget || null;
      return textResult(payload);
    } catch (error) {
      outcome = 'failure';
      if (error instanceof ToolError || error instanceof AppError) {
        errorCode = error.code || 'ERROR';
        return errorResult(error.message, errorCode);
      }
      errorCode = 'INTERNAL';
      logger.error({ tool: name, reason: error.message }, 'MCP tool failed unexpectedly');
      return errorResult('AI Infographic Studio could not complete this request. Try again later.', 'INTERNAL');
    } finally {
      await touchConnection(auth, name);
      await recordAudit({
        req: requestMeta,
        actor: user || (auth?.extra?.userId ? { _id: auth.extra.userId } : null),
        action: `mcp.tool.${name}`,
        area: 'mcp',
        outcome,
        target,
        summary: `${auth?.extra?.clientName || 'AI app'} called ${name}${errorCode ? ` (${errorCode})` : ''}`.slice(0, 500),
        metadata: {
          tool: name,
          client: auth?.extra?.clientName || null,
          connectionId: auth?.extra?.connectionId || null,
          args: sanitizeArgs(args),
          errorCode,
          ms: Date.now() - started,
        },
      });
    }
  };
}

// ---------------------------------------------------------------- shapes

const IMAGE_NOTE =
  'The image is stored privately in AI Infographic Studio. Open web_url while signed in to view it in full size or download it.';

function imageInfo(item) {
  if (!item.image) return null;
  return {
    width: item.image.width,
    height: item.image.height,
    mime_type: item.image.mimeType,
    size_bytes: item.image.size,
    download_url: webUrl(`${item.image.url}?download=1`),
    note: 'download_url works in a browser that is signed in to the same AI Infographic Studio account.',
  };
}

function infographicSummary(item) {
  return {
    infographic_id: item.id,
    title: item.title,
    style: item.style,
    aspect_ratio: item.aspectRatio,
    status: item.status,
    has_image: Boolean(item.image),
    error: item.error,
    created_at: item.createdAt,
    web_url: webUrl(`/generations/${item.id}`),
  };
}

function infographicDetails(item) {
  return {
    infographic_id: item.id,
    title: item.title,
    topic: item.topic,
    style: item.style,
    aspect_ratio: item.aspectRatio,
    model: item.model,
    source: item.source,
    status: item.status,
    progress: item.progress?.message || null,
    image: imageInfo(item),
    error: item.error,
    regenerated_from: item.regeneratedFrom,
    created_at: item.createdAt,
    completed_at: item.completedAt,
    web_url: webUrl(`/generations/${item.id}`),
    note: item.status === 'completed' ? IMAGE_NOTE : null,
  };
}

function statusDetails(item) {
  const done = ['completed', 'failed', 'cancelled'].includes(item.status);
  return {
    infographic_id: item.id,
    status: item.status,
    finished: done,
    message: item.progress?.message || (item.status === 'completed' ? 'Ready' : item.error?.message || null),
    image: imageInfo(item),
    error: item.error,
    web_url: webUrl(`/generations/${item.id}`),
    next_step: done
      ? item.status === 'completed'
        ? IMAGE_NOTE
        : 'This generation did not finish. You can start a new one with generate_infographic after the user agrees.'
      : 'Still generating. Call get_generation_status again in 15-30 seconds.',
  };
}

async function requireProviderKey(user) {
  // Paused by the administrator: refuse before anything is created.
  await assertGenerationAllowed();
  const credential = await ApiCredential.findOne({ userId: user._id, provider: 'kie' }).select('status').lean();
  if (!credential) {
    throw new ToolError('Connect your own Kie.ai API key in AI Infographic Studio (API Settings) before generating. Nothing was started.', 'NO_API_KEY');
  }
  if (credential.status === 'invalid') {
    throw new ToolError('Kie.ai rejected the saved API key. Replace it in AI Infographic Studio (API Settings). Nothing was started.', 'API_KEY_INVALID');
  }
}

// ---------------------------------------------------------------- registration

/**
 * The SDK's per-tool scope challenge: a call without the needed scope gets
 * HTTP 403 with WWW-Authenticate error="insufficient_scope" and the scopes to
 * request, so clients can ask the user for more access (MCP step-up flow).
 */
function challengeFor(name, fallbackAuth) {
  const tool = toolByName(name);
  return ({ request, authInfo }) => {
    const info = authInfo || fallbackAuth;
    if (!info) return undefined; // unauthenticated requests are refused earlier with 401
    if (tool.scopeByPurpose) {
      const needed = tool.scopeByPurpose[request.params?.arguments?.purpose] || tool.scopes[0];
      return hasScopes(info, [needed]) ? undefined : { scopes: [needed], errorDescription: `${name} needs the ${needed} permission` };
    }
    if (hasScopes(info, tool.scopes, tool.anyScope)) return undefined;
    return { scopes: [...tool.scopes], errorDescription: `${name} needs the ${tool.scopes.join(tool.anyScope ? ' or ' : ' and ')} permission` };
  };
}

export function registerTools(server, auth, requestMeta) {
  const run = runner(auth, requestMeta);

  server.registerTool(
    'generate_infographic',
    {
      scopeChallenge: challengeFor('generate_infographic', auth),
      title: 'Generate an infographic',
      description: [
        'Create a professional infographic image from a topic with Z-Image on Kie.ai, using the signed-in user\'s own Kie.ai API key.',
        'Returns an infographic_id immediately; generation runs in the background (usually under two minutes). Poll get_generation_status.',
        PAID_NOTE,
      ].join(' '),
      inputSchema: z.strictObject({
        topic: z
          .string()
          .min(TOPIC_MIN)
          .max(TOPIC_MAX)
          .describe('What the infographic should explain, e.g. "5 benefits of AI automation for small businesses". Facts and figures should come from the user; none are invented.'),
        style: z.enum(INFOGRAPHIC_STYLES).describe('minimal (clean, neutral), corporate (structured business look) or colorful (vibrant, friendly illustrations)'),
        aspect_ratio: z.enum(INFOGRAPHIC_RATIOS).describe('1:1 square, 3:4 portrait or 9:16 vertical'),
        idempotency_key: z
          .string()
          .regex(/^[A-Za-z0-9_-]{8,60}$/)
          .optional()
          .describe('Optional. Reuse the same key when retrying a call so it is not generated (and charged) twice.'),
        confirm_paid_generation: z.literal(true).describe('Must be true: the user agreed to a paid generation on their own Kie.ai account.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run('generate_infographic', async (user, args) => {
      requireScope(auth, 'infographics:write');
      await requireProviderKey(user);
      const body = { topic: args.topic, style: args.style, aspectRatio: args.aspect_ratio };
      // Without a key from the assistant, identical requests within about two
      // minutes map to the same generation, so a retried call does not pay twice.
      const window = Math.floor(Date.now() / 120000);
      const idempotencyKey = args.idempotency_key
        ? `mcp_${auth.extra.connectionId}_${args.idempotency_key}`
        : `mcp_${crypto.createHash('sha256').update(`${auth.extra.connectionId}:${window}:${JSON.stringify(body)}`).digest('base64url').slice(0, 40)}`;
      const { infographic, deduplicated } = await infographicService.createInfographic(user, body, {
        idempotencyKey,
        source: 'mcp',
        req: requestMeta,
      });
      return {
        target: { type: 'infographic', id: infographic.id },
        payload: {
          ...infographicDetails(infographic),
          deduplicated,
          charges: deduplicated
            ? 'This request matched an infographic already started, so nothing new was charged.'
            : 'One paid image generation started on the user\'s own Kie.ai account (uses their credits).',
          next_steps: 'Call get_generation_status with infographic_id every 15-30 seconds until finished is true.',
        },
      };
    }),
  );

  server.registerTool(
    'get_generation_status',
    {
      scopeChallenge: challengeFor('get_generation_status', auth),
      title: 'Check generation status',
      description: 'Status of an infographic generation (infographic_id from generate_infographic). When completed, includes the image size and a link to view or download it.',
      inputSchema: z.strictObject({ infographic_id: objectId('infographic_id') }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run('get_generation_status', async (user, { infographic_id: id }) => {
      const item = await infographicService.getInfographic(user, id);
      return { target: { type: 'infographic', id }, payload: statusDetails(item) };
    }),
  );

  server.registerTool(
    'list_infographics',
    {
      scopeChallenge: challengeFor('list_infographics', auth),
      title: 'List infographics',
      description: 'The user\'s infographic history, newest first, with status. Only this user\'s own infographics are returned.',
      inputSchema: z.strictObject({
        status: z.enum(['all', 'active', 'completed', 'failed', 'cancelled']).optional().describe('Filter by status (default all)'),
        page: z.number().int().min(1).max(1000).optional().describe('Default 1'),
        limit: z.number().int().min(1).max(50).optional().describe('Default 20'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run('list_infographics', async (user, { status, page, limit }) => {
      const result = await infographicService.listInfographics(user, { status: status || 'all', page: page || 1, limit: limit || 20 });
      return {
        payload: {
          count: result.items.length,
          total: result.total,
          page: result.page,
          pages: result.pages,
          infographics: result.items.map(infographicSummary),
        },
      };
    }),
  );

  server.registerTool(
    'get_infographic',
    {
      scopeChallenge: challengeFor('get_infographic', auth),
      title: 'Get an infographic',
      description: 'Full details of one of the user\'s infographics: topic, style, aspect ratio, status, error and image information.',
      inputSchema: z.strictObject({ infographic_id: objectId('infographic_id') }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run('get_infographic', async (user, { infographic_id: id }) => {
      const item = await infographicService.getInfographic(user, id);
      return { target: { type: 'infographic', id }, payload: infographicDetails(item) };
    }),
  );
}
