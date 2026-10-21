import { Router } from 'express';
import { getBranding, toPublicBranding, brandingImage } from '../services/branding.service.js';
import { validate } from '../middleware/validate.js';
import { brandingImageParam } from '../validators/admin.validator.js';

/**
 * /api/branding: public (the sign-in page needs it). Only the name, tagline,
 * accent colour and the uploaded logo/favicon images; nothing else.
 */
export function createBrandingRouter() {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ branding: toPublicBranding(await getBranding()) });
  });

  router.get('/:kind', validate({ params: brandingImageParam }), async (req, res) => {
    const { buffer, mimeType } = await brandingImage(req.validated.params.kind);
    res.set({
      'Content-Type': mimeType,
      'Content-Length': String(buffer.length),
      // Versioned URLs (?v=) change on every upload, so they can be cached long.
      'Cache-Control': req.query.v ? 'public, max-age=86400, immutable' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.end(buffer);
  });

  return router;
}
