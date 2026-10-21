// MongoDB storage adapter for the OAuth authorization server (oidc-provider).
//
// One collection per oidc-provider model ("oauth_accesstoken", ...). Every
// artefact that works as a bearer credential (access and refresh tokens,
// authorization codes, ...) is stored under a SHA-256 hash of its value and
// without its `jti`, so a database dump does not contain usable tokens.
// Expired documents are removed by TTL indexes and are never returned.
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import epochTime from './epochTime.js';

const PREFIX = 'oauth_';

// Models whose identifier is itself a secret.
const HASHED = new Set([
  'AccessToken',
  'AuthorizationCode',
  'RefreshToken',
  'ClientCredentials',
  'DeviceCode',
  'BackchannelAuthenticationRequest',
  'InitialAccessToken',
  'RegistrationAccessToken',
]);

// Dynamically registered clients that never get an approved connection are
// removed after this long (DCR lets anyone register, so they must not pile up).
const UNUSED_CLIENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MODELS = [
  'Session',
  'AccessToken',
  'AuthorizationCode',
  'RefreshToken',
  'DeviceCode',
  'ClientCredentials',
  'Client',
  'InitialAccessToken',
  'RegistrationAccessToken',
  'Interaction',
  'ReplayDetection',
  'PushedAuthorizationRequest',
  'Grant',
  'BackchannelAuthenticationRequest',
  // Ours: client details shown on the consent page for one pending request.
  'InteractionClient',
];

function collection(model) {
  const db = mongoose.connection.db;
  if (!db || mongoose.connection.readyState !== 1) throw new Error('Database is not connected');
  return db.collection(`${PREFIX}${model.toLowerCase()}`);
}

function hashId(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url');
}

export class MongoOAuthAdapter {
  constructor(name) {
    this.name = name;
    this.hashed = HASHED.has(name);
  }

  key(id) {
    return this.hashed ? hashId(id) : String(id);
  }

  async upsert(id, payload, expiresIn) {
    const stored = { ...payload };
    if (this.hashed) delete stored.jti;
    const update = { $set: { payload: stored } };
    if (expiresIn) {
      update.$set.expiresAt = new Date(Date.now() + expiresIn * 1000);
    } else if (this.name === 'Client') {
      // Kept only once a user approves a connection for it (see pinClient).
      update.$setOnInsert = { expiresAt: new Date(Date.now() + UNUSED_CLIENT_TTL_MS) };
    }
    await collection(this.name).updateOne({ _id: this.key(id) }, update, { upsert: true });
  }

  restore(doc, id) {
    if (!doc) return undefined;
    if (doc.expiresAt && doc.expiresAt <= new Date()) return undefined;
    return this.hashed && id !== undefined ? { ...doc.payload, jti: String(id) } : doc.payload;
  }

  async find(id) {
    return this.restore(await collection(this.name).findOne({ _id: this.key(id) }), id);
  }

  async findByUserCode(userCode) {
    return this.restore(await collection(this.name).findOne({ 'payload.userCode': userCode }));
  }

  async findByUid(uid) {
    return this.restore(await collection(this.name).findOne({ 'payload.uid': uid }));
  }

  async consume(id) {
    await collection(this.name).updateOne({ _id: this.key(id) }, { $set: { 'payload.consumed': epochTime() } });
  }

  async destroy(id) {
    await collection(this.name).deleteOne({ _id: this.key(id) });
  }

  async revokeByGrantId(grantId) {
    await collection(this.name).deleteMany({ 'payload.grantId': grantId });
  }
}

/** Remove every token, code and the grant itself for one grant id. */
export async function revokeGrantArtifacts(grantId) {
  for (const model of ['AccessToken', 'RefreshToken', 'AuthorizationCode', 'DeviceCode', 'BackchannelAuthenticationRequest']) {
    await new MongoOAuthAdapter(model).revokeByGrantId(grantId);
  }
  await new MongoOAuthAdapter('Grant').destroy(grantId);
}

/** A dynamically registered client with an approved connection is kept. */
export async function pinClient(clientId) {
  await collection('Client').updateOne({ _id: String(clientId) }, { $unset: { expiresAt: '' } });
}

/** TTL and lookup indexes for every OAuth collection (idempotent). */
export async function ensureOAuthIndexes() {
  for (const model of MODELS) {
    const coll = collection(model);
    await coll.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_ttl' });
    if (['AccessToken', 'RefreshToken', 'AuthorizationCode', 'DeviceCode', 'BackchannelAuthenticationRequest'].includes(model)) {
      await coll.createIndex({ 'payload.grantId': 1 }, { name: 'grantId', sparse: true });
    }
    if (model === 'Session') await coll.createIndex({ 'payload.uid': 1 }, { name: 'uid', sparse: true });
    if (model === 'DeviceCode') await coll.createIndex({ 'payload.userCode': 1 }, { name: 'userCode', sparse: true });
  }
}

export const __test = { hashId, PREFIX };
