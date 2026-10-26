import { Router } from 'express';
import * as controller from '../controllers/auth.controller.js';
import * as creditsController from '../controllers/credits.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';
import { requireDatabase } from '../middleware/requireDatabase.js';
import { createAuthLimiter, createEmailLimiter } from '../middleware/rateLimit.js';
import { signupBody, loginBody, forgotPasswordBody, resetPasswordBody } from '../validators/auth.validator.js';

export function createAuthRouter({ env }) {
  const router = Router();
  const ipLimiter = createAuthLimiter(env);
  const loginIpLimiter = createAuthLimiter(env, { skipSuccessfulRequests: true });
  const loginEmailLimiter = createEmailLimiter(env, { skipSuccessfulRequests: true });
  const resetEmailLimiter = createEmailLimiter(env);

  router.use(requireDatabase);

  router.post('/signup', ipLimiter, validate({ body: signupBody }), controller.signup);
  router.post('/login', loginIpLimiter, validate({ body: loginBody }), loginEmailLimiter, controller.login);
  router.post('/logout', authenticate, controller.logout);
  router.get('/me', authenticate, controller.me);
  router.post('/act-as/stop', authenticate, controller.stopActingAs);

  // Sign in with Google: browser navigations that end in a redirect.
  const googleLimiter = createAuthLimiter(env);
  // The callback works without a session (sign-in); a broken session must
  // not turn it into a JSON error page, so session problems are ignored here.
  const sessionIfAny = (req, res, next) => optionalAuthenticate(req, res, () => next());
  router.get('/options', controller.options);
  // What a bonus sign-up link gives (the sign-up page shows it).
  router.get('/bonus/:code', ipLimiter, creditsController.describeBonus);
  router.get('/google/start', googleLimiter, controller.googleStart);
  router.get('/google/connect', googleLimiter, authenticate, controller.googleConnectStart);
  router.get('/google/callback', googleLimiter, sessionIfAny, controller.googleCallback);
  router.post('/forgot-password', ipLimiter, validate({ body: forgotPasswordBody }), resetEmailLimiter, controller.forgotPassword);
  router.post('/reset-password', ipLimiter, validate({ body: resetPasswordBody }), controller.resetPassword);

  return router;
}
