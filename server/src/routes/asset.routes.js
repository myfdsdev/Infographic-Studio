import { Router } from 'express';
import multer from 'multer';
import * as controller from '../controllers/asset.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireDatabase } from '../middleware/requireDatabase.js';
import { AppError } from '../utils/errors.js';

/** Multipart parser for one image in the "file" field, kept in memory, size-capped. */
export function createImageReceiver(env) {
  const parser = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024, files: 1, fields: 4, fieldSize: 256, parts: 6 },
  }).single('file');

  const receive = (req, res, next) => {
    parser(req, res, (error) => {
      if (!error) {
        if (!req.file) return next(new AppError('Attach an image in the "file" field', { statusCode: 400, code: 'FILE_REQUIRED' }));
        return next();
      }
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(`The image is larger than ${env.UPLOAD_MAX_MB} MB`, { statusCode: 413, code: 'FILE_TOO_LARGE' }));
      }
      if (error instanceof multer.MulterError) {
        return next(new AppError('Upload one image file with the required fields only', { statusCode: 400, code: 'BAD_UPLOAD' }));
      }
      return next(new AppError('The upload could not be read', { statusCode: 400, code: 'BAD_UPLOAD' }));
    });
  };
  return receive;
}

/** /api/assets/:id/content and DELETE /api/assets/:id (owner only). */
export function createAssetRouter() {
  const router = Router();
  router.use(requireDatabase, authenticate);
  router.get('/:id/content', controller.content);
  router.delete('/:id', controller.remove);
  return router;
}
