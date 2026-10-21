import { pipeline } from 'node:stream/promises';
import * as infographicService from '../services/infographic.service.js';

function idempotencyKeyFrom(req) {
  const header = req.get('Idempotency-Key');
  return req.validated.body?.idempotencyKey || (header && /^[A-Za-z0-9_-]{8,100}$/.test(header) ? header : undefined);
}

export async function options(_req, res) {
  res.json(infographicService.infographicOptions());
}

export async function list(req, res) {
  res.json(await infographicService.listInfographics(req.user, req.validated.query));
}

export async function get(req, res) {
  res.json({ infographic: await infographicService.getInfographic(req.user, req.validated.params.id) });
}

export async function create(req, res) {
  const { topic, style, aspectRatio } = req.validated.body;
  const result = await infographicService.createInfographic(req.user, { topic, style, aspectRatio }, { idempotencyKey: idempotencyKeyFrom(req), req });
  res.status(result.deduplicated ? 200 : 202).json(result);
}

export async function regenerate(req, res) {
  const result = await infographicService.regenerateInfographic(req.user, req.validated.params.id, { idempotencyKey: idempotencyKeyFrom(req), req });
  res.status(result.deduplicated ? 200 : 202).json(result);
}

export async function remove(req, res) {
  await infographicService.deleteInfographic(req.user, req.validated.params.id, req);
  res.json({ ok: true });
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Owner-only image bytes; ?download=1 saves it as a file. */
export async function image(req, res) {
  const { item, asset, stream } = await infographicService.openInfographicImage(req.user, req.validated.params.id);
  const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'infographic';
  res.setHeader('Content-Type', asset.mimeType);
  res.setHeader('Content-Length', String(asset.size));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader(
    'Content-Disposition',
    req.validated.query.download === '1' ? `attachment; filename="${slug}-${String(item._id).slice(-6)}.${EXT[asset.mimeType] || 'png'}"` : 'inline',
  );
  await pipeline(stream, res);
}
