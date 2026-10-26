// Registry of every model, so indexes can be ensured in one place (server
// start-up, scripts/createIndexes.js and the test environment).
import User from './User.js';
import Session from './Session.js';
import PasswordResetToken from './PasswordResetToken.js';
import AuditLog from './AuditLog.js';
import AppSettings from './AppSettings.js';
import ApiCredential from './ApiCredential.js';
import GenerationJob from './GenerationJob.js';
import Asset from './Asset.js';
import Infographic from './Infographic.js';
import McpConnection from './McpConnection.js';
import OpsLog from './OpsLog.js';
import CreditTransaction from './CreditTransaction.js';
import BonusLink from './BonusLink.js';
import { ensureOAuthIndexes } from '../mcp/oauthStore.js';

export const allModels = Object.freeze([
  User,
  Session,
  PasswordResetToken,
  AuditLog,
  AppSettings,
  ApiCredential,
  GenerationJob,
  Asset,
  Infographic,
  McpConnection,
  OpsLog,
  CreditTransaction,
  BonusLink,
]);

/** Create any missing indexes. Non-destructive: existing indexes are kept. */
export async function ensureIndexes() {
  const results = [];
  for (const model of allModels) {
    await model.createCollection().catch((error) => {
      // 48 = NamespaceExists, which is fine.
      if (error?.code !== 48) throw error;
    });
    await model.createIndexes();
    results.push(model.modelName);
  }
  // OAuth server collections (TTL and lookup indexes).
  await ensureOAuthIndexes();
  results.push('oauth');
  return results;
}

export {
  User,
  Session,
  PasswordResetToken,
  AuditLog,
  AppSettings,
  ApiCredential,
  GenerationJob,
  Asset,
  Infographic,
  McpConnection,
  OpsLog,
  CreditTransaction,
  BonusLink,
};
