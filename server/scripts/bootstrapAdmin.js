#!/usr/bin/env node
// One-time owner/admin bootstrap.
//
//   node scripts/bootstrapAdmin.js --email you@example.com --confirm-email you@example.com [--name "Your Name"]
//
// Rules (enforced, not just documented):
//   - Runs only while the database has NO administrator and the bootstrap has
//     never completed. A marker in AppSettings makes it strictly one-time.
//   - The email must be typed twice and match.
//   - There is no default password. It is read from ADMIN_PASSWORD in
//     server/.env when set; otherwise it is prompted twice with hidden input.
//     Admin passwords need at least 12 characters with letters and numbers.
//   - If an account with that email already exists (for example someone signed
//     up with it first), it is promoted ONLY after its password is replaced and
//     every existing session of that account is revoked.
//   - Public sign-ups are never promoted automatically.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const MARKER_KEY = 'owner_bootstrap';
const ADMIN_PASSWORD_MIN = 12;

export class BootstrapError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BootstrapError';
  }
}

function normalize(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/**
 * Core logic, shared by the CLI and the automated tests.
 * Expects an open Mongoose connection.
 */
export async function runBootstrap({
  email,
  confirmEmail,
  name,
  password,
  keepExistingPassword = false,
  actorLabel = 'system:bootstrap',
}) {
  const { User } = await import('../src/models/User.js');
  const { Session } = await import('../src/models/Session.js');
  const { AppSettings } = await import('../src/models/AppSettings.js');
  const { hashPassword, checkPasswordPolicy } = await import('../src/utils/password.js');
  const { recordAudit } = await import('../src/services/audit.service.js');

  const normalized = normalize(email);
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) {
    throw new BootstrapError('Provide a valid --email.');
  }
  if (normalized !== normalize(confirmEmail)) {
    throw new BootstrapError('--email and --confirm-email do not match.');
  }
  if (!keepExistingPassword) {
    const policyError = checkPasswordPolicy(password, { min: ADMIN_PASSWORD_MIN });
    if (policyError) throw new BootstrapError(`Admin password rejected: ${policyError}.`);
  } else if (!(await User.exists({ email: normalized }))) {
    throw new BootstrapError('--keep-password only works for an account that already exists. Sign up first, or run without it.');
  }

  const existingAdmin = await User.findOne({ role: 'admin' }).lean();
  if (existingAdmin) {
    throw new BootstrapError(
      'An administrator already exists. Use the admin panel to manage roles; the bootstrap only runs on an empty installation.',
    );
  }

  // Claim the one-time marker atomically; a second concurrent run fails here.
  try {
    await AppSettings.create({
      key: MARKER_KEY,
      value: { status: 'in_progress', email: normalized, startedAt: new Date() },
      updatedBy: actorLabel,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const marker = await AppSettings.findOne({ key: MARKER_KEY }).lean();
      const when = marker?.value?.completedAt ? new Date(marker.value.completedAt).toISOString() : 'earlier';
      throw new BootstrapError(`The owner bootstrap already ran (${when}). It can only run once.`);
    }
    throw error;
  }

  try {
    const passwordHash = keepExistingPassword ? null : await hashPassword(password);
    const existing = await User.findOne({ email: normalized });
    let user;
    let mode;

    if (existing) {
      // The owner confirmed this existing account is theirs (--keep-password):
      // keep its password. Otherwise replace it, which neutralises anyone who
      // signed up with the owner's address first.
      if (passwordHash) {
        existing.passwordHash = passwordHash;
        existing.passwordChangedAt = new Date();
      }
      existing.role = 'admin';
      existing.status = 'active';
      existing.suspendedAt = null;
      existing.suspendedReason = null;
      existing.suspendedBy = null;
      if (name) existing.name = name;
      await existing.save();
      await Session.updateMany(
        { userId: existing._id, revokedAt: null },
        { revokedAt: new Date(), revokedReason: 'owner_bootstrap' },
      );
      user = existing;
      mode = keepExistingPassword ? 'promoted_kept_password' : 'promoted';
    } else {
      if (!passwordHash) throw new BootstrapError('No password available for a new account.');
      user = await User.create({
        email: normalized,
        name: name || normalized.split('@')[0],
        passwordHash,
        role: 'admin',
        status: 'active',
        passwordChangedAt: new Date(),
      });
      mode = 'created';
    }

    await AppSettings.updateOne(
      { key: MARKER_KEY },
      { value: { status: 'completed', email: normalized, mode, completedAt: new Date(), userId: String(user._id) } },
    );
    await recordAudit({
      actor: actorLabel,
      action: mode === 'created' ? 'system.owner_admin_created' : 'system.owner_admin_promoted',
      area: 'system',
      target: { type: 'user', id: user._id, email: user.email },
      summary:
        mode === 'created'
          ? 'Owner administrator created by the one-time bootstrap'
          : mode === 'promoted'
            ? 'Existing account promoted to owner administrator; password replaced and sessions revoked'
            : 'Existing account promoted to owner administrator on owner confirmation; password kept, sessions revoked',
    });
    return { mode, userId: String(user._id), email: user.email };
  } catch (error) {
    // Roll back the marker so a failed run can be retried.
    await AppSettings.deleteOne({ key: MARKER_KEY, 'value.status': 'in_progress' }).catch(() => {});
    throw error;
  }
}

// ---- CLI --------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=');
    const value = inline !== undefined ? inline : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    args[key] = value;
  }
  return args;
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new BootstrapError('No interactive terminal for a hidden password prompt.'));
      return;
    }
    stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword(env) {
  // An ADMIN_PASSWORD the owner put in server/.env wins; otherwise ask.
  if (env.ADMIN_PASSWORD) {
    console.warn('Using ADMIN_PASSWORD from server/.env. Remove it from the file after this run.');
    return env.ADMIN_PASSWORD;
  }
  if (process.stdin.isTTY) {
    const first = await promptHidden(`Choose the admin password (min ${ADMIN_PASSWORD_MIN} chars, letters + numbers): `);
    const second = await promptHidden('Type it again: ');
    if (first !== second) throw new BootstrapError('The two passwords do not match.');
    return first;
  }
  throw new BootstrapError(
    'ADMIN_PASSWORD is not set and there is no terminal for a hidden prompt. Set ADMIN_PASSWORD in server/.env for this one run, or run the command in PowerShell or cmd.',
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'Usage: node scripts/bootstrapAdmin.js --email you@example.com --confirm-email you@example.com [--name "Your Name"] [--keep-password]',
    );
    return 0;
  }
  const email = args.email || process.env.ADMIN_EMAIL;
  const confirmEmail = args['confirm-email'];
  if (!email || !confirmEmail) {
    console.error('Both --email and --confirm-email are required (type the address twice).');
    return 2;
  }

  const { env } = await import('../src/config/env.js');
  const { ensureIndexes } = await import('../src/models/index.js');

  const keepExistingPassword = args['keep-password'] === 'true';
  const password = keepExistingPassword ? undefined : await readPassword(env);
  console.log(`Connecting to MongoDB database "${env.databaseName}"...`);
  await mongoose.connect(env.MONGODB_URI, { dbName: env.databaseName, serverSelectionTimeoutMS: 10000 });
  try {
    await ensureIndexes();
    const result = await runBootstrap({ email, confirmEmail, name: args.name, password, keepExistingPassword });
    console.log(
      result.mode === 'created'
        ? `Owner administrator created for ${result.email}.`
        : result.mode === 'promoted'
          ? `Existing account ${result.email} promoted to administrator. Its password was replaced and all its sessions were signed out.`
          : `Existing account ${result.email} promoted to administrator. Its password is unchanged; sign in again to continue.`,
    );
    if (!keepExistingPassword) {
      console.log('Sign in at the client URL with this email and the admin password.');
    }
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof BootstrapError ? `Bootstrap refused: ${error.message}` : error);
      process.exit(1);
    });
}
