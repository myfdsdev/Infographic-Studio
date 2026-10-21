import mongoose from 'mongoose';

export const CREDENTIAL_PROVIDERS = Object.freeze(['kie']);
export const CREDENTIAL_STATUSES = Object.freeze(['unverified', 'valid', 'invalid']);

// A user's own provider API key, encrypted at rest with AES-256-GCM (see
// utils/encryption.js). The ciphertext is never selected unless a query asks
// for it explicitly, and it never leaves the server: only `last4`, status and
// balance are ever returned.
const apiCredentialSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: CREDENTIAL_PROVIDERS, required: true },
    encryptedKey: { type: String, required: true, select: false },
    last4: { type: String, default: '' },
    status: { type: String, enum: CREDENTIAL_STATUSES, default: 'unverified' },
    lastVerifiedAt: { type: Date, default: null },
    lastCheckError: { type: String, default: null, maxlength: 300 },
    balance: { type: Number, default: null },
    balanceCheckedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

apiCredentialSchema.index({ userId: 1, provider: 1 }, { unique: true });

export const ApiCredential = mongoose.models.ApiCredential || mongoose.model('ApiCredential', apiCredentialSchema);
export default ApiCredential;
