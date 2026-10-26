import { Router } from 'express';
import * as controller from '../controllers/settings.controller.js';
import * as creditsController from '../controllers/credits.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireDatabase } from '../middleware/requireDatabase.js';
import { createAuthLimiter } from '../middleware/rateLimit.js';
import {
  objectIdParam,
  updateAccountBody,
  changePasswordBody,
  deleteAccountBody,
} from '../validators/settings.validator.js';
import { providerParam, saveCredentialBody } from '../validators/job.validator.js';

// Everything here acts on the signed-in user's own account only.
export function createSettingsRouter({ env }) {
  const router = Router();
  const sensitiveLimiter = createAuthLimiter(env);

  router.use(requireDatabase, authenticate);

  router.get('/account', controller.getAccount);
  router.patch('/account', validate({ body: updateAccountBody }), controller.updateAccount);
  router.post('/account/password', sensitiveLimiter, validate({ body: changePasswordBody }), controller.changePassword);
  router.post('/account/delete', sensitiveLimiter, validate({ body: deleteAccountBody }), controller.deleteAccount);
  router.post('/account/google/disconnect', controller.disconnectGoogle);

  router.get('/sessions', controller.listSessions);
  router.post('/sessions/revoke-others', controller.revokeOtherSessions);
  router.delete('/sessions/:id', validate({ params: objectIdParam }), controller.revokeSession);

  router.get('/providers', controller.providers);
  router.get('/credentials', controller.listCredentials);
  router.put('/credentials/:provider', sensitiveLimiter, validate({ params: providerParam, body: saveCredentialBody }), controller.saveCredential);
  router.post('/credentials/:provider/verify', sensitiveLimiter, validate({ params: providerParam }), controller.verifyCredential);
  router.delete('/credentials/:provider', validate({ params: providerParam }), controller.deleteCredential);

  router.get('/credits', creditsController.myCredits);

  return router;
}
