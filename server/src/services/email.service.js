// Outgoing email.
//
// Providers (EMAIL_PROVIDER):
//   smtp     real delivery through nodemailer + SMTP_* settings
//   console  development only: the message is written to the server log and
//            NOT delivered. Refused in production by env validation.
//   memory   automated tests only: messages are kept in process memory.
//
// getEmailStatus() reports honestly whether mail actually reaches inboxes; the
// readiness endpoint and the admin overview surface it.
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const memoryOutbox = [];
let transporter = null;

const state = {
  verified: null,
  lastError: null,
  lastSentAt: null,
  lastVerifiedAt: null,
};

function smtpTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

/** Check SMTP credentials once at start-up (non-blocking for the caller). */
export async function verifyEmailTransport() {
  if (env.EMAIL_PROVIDER !== 'smtp') return getEmailStatus();
  try {
    await smtpTransporter().verify();
    state.verified = true;
    state.lastError = null;
    logger.info({ host: env.SMTP_HOST, port: env.SMTP_PORT }, 'SMTP transport verified');
  } catch (error) {
    state.verified = false;
    state.lastError = error.message;
    logger.error({ reason: error.message, host: env.SMTP_HOST }, 'SMTP transport verification failed');
  }
  state.lastVerifiedAt = new Date();
  return getEmailStatus();
}

export function getEmailStatus() {
  const provider = env.EMAIL_PROVIDER;
  const configured = provider === 'smtp' ? Boolean(env.SMTP_HOST) : provider !== 'memory' || env.isTest;
  return {
    provider,
    configured,
    deliversToInbox: provider === 'smtp' && state.verified !== false,
    verified: provider === 'smtp' ? state.verified : null,
    lastError: state.lastError,
    lastSentAt: state.lastSentAt,
    note:
      provider === 'console'
        ? 'Development mode: emails are written to the server log and are not delivered.'
        : provider === 'memory'
          ? 'Test mode: emails are kept in memory.'
          : state.verified === false
            ? 'SMTP is configured but verification failed; emails may not be delivered.'
            : null,
  };
}

export async function sendEmail({ to, subject, text, html }) {
  const message = { from: env.EMAIL_FROM, to, subject, text, html };

  if (env.EMAIL_PROVIDER === 'memory') {
    memoryOutbox.push({ ...message, sentAt: new Date() });
    state.lastSentAt = new Date();
    return { provider: 'memory', delivered: false };
  }

  if (env.EMAIL_PROVIDER === 'console') {
    logger.info({ email: { to, subject, body: text } }, 'Email NOT delivered (EMAIL_PROVIDER=console); content below');
    state.lastSentAt = new Date();
    return { provider: 'console', delivered: false };
  }

  try {
    const info = await smtpTransporter().sendMail(message);
    state.lastSentAt = new Date();
    state.lastError = null;
    state.verified = true;
    return { provider: 'smtp', delivered: true, messageId: info.messageId };
  } catch (error) {
    state.lastError = error.message;
    throw error;
  }
}

// ---- test helpers (memory provider only) ---------------------------------
export function getSentEmails() {
  return [...memoryOutbox];
}

export function clearSentEmails() {
  memoryOutbox.length = 0;
}

// ---- templates ------------------------------------------------------------
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function passwordResetEmail({ name, link, minutes, appName = 'AI Infographic Studio' }) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const subject = `Reset your ${appName} password`;
  const text = [
    greeting,
    '',
    `We received a request to reset the password for your ${appName} account.`,
    `Open this link within ${minutes} minutes to choose a new password:`,
    '',
    link,
    '',
    'If you did not ask for this, you can ignore this email; your password will not change.',
    '',
    appName,
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#000;color:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0a0a0a;border:1px solid #262626;border-radius:16px;padding:28px">
<tr><td style="font-size:20px;font-weight:700;padding-bottom:12px">Reset your password</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#c4c4c4">${escapeHtml(greeting)}<br><br>We received a request to reset the password for your ${escapeHtml(appName)} account. This link expires in ${Number(minutes)} minutes.</td></tr>
<tr><td style="padding:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#fff;color:#000;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">Choose a new password</a></td></tr>
<tr><td style="font-size:12px;line-height:1.6;color:#8a8a8a">If the button does not work, paste this address into your browser:<br><span style="word-break:break-all;color:#c4c4c4">${escapeHtml(link)}</span><br><br>If you did not ask for this, ignore this email; your password will not change.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
