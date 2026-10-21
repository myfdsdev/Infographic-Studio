import { pipeline } from 'node:stream/promises';
import * as assetService from '../services/asset.service.js';

/** "bytes=start-end" -> { start, end } within the file, or null when absent/invalid. */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

const DOWNLOAD_EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * Owner-only file bytes. Private cache, no sniffing, same-site embedding only.
 * Supports Range requests and ?download=1.
 */
export async function content(req, res) {
  const owned = await assetService.getOwnedAsset(req.user._id, req.params.id);
  const range = req.headers.range ? parseRange(req.headers.range, owned.size) : null;
  if (range === 'unsatisfiable') {
    res.setHeader('Content-Range', `bytes */${owned.size}`);
    res.status(416).end();
    return;
  }
  const { asset, stream } = await assetService.openAssetContent(req.user._id, req.params.id, { range });
  res.setHeader('Content-Type', asset.mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  const name = `infographic-studio-${asset.purpose.replace(/_/g, '-')}-${String(asset._id).slice(-8)}.${DOWNLOAD_EXT[asset.mimeType] || 'bin'}`;
  res.setHeader('Content-Disposition', req.query.download === '1' ? `attachment; filename="${name}"` : 'inline');
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${asset.size}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
  } else {
    res.setHeader('Content-Length', String(asset.size));
  }
  await pipeline(stream, res);
}

export async function remove(req, res) {
  await assetService.deleteAsset(req.user, req.params.id, req);
  res.json({ ok: true });
}
