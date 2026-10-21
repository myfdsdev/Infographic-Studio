import mongoose from 'mongoose';

// What a stored file is for.
//   infographic_image  a generated infographic, copied from the provider's
//                      temporary URL into private storage
export const ASSET_PURPOSES = Object.freeze(['infographic_image']);

// Short-lived copies of this file on a provider (Kie.ai File Upload API keeps
// them 24 hours). Reused while still fresh.
const providerCopySchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    url: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { _id: false },
);

// Metadata for a file in object storage. The bytes themselves live in the
// storage driver under `storageKey` and are only served to their owner.
const assetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: ASSET_PURPOSES, required: true },
    source: { type: String, enum: ['upload', 'generated'], required: true },
    storageDriver: { type: String, required: true },
    storageKey: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    durationSeconds: { type: Number, default: null },
    sha256: { type: String, required: true },
    originalName: { type: String, default: null, maxlength: 200 },
    // For generated files: which job produced it and which provider URL it came from.
    sourceJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'GenerationJob', default: null },
    providerCopies: { type: [providerCopySchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

assetSchema.index({ userId: 1, purpose: 1, createdAt: -1 });
assetSchema.index({ storageKey: 1 }, { unique: true });

export const Asset = mongoose.models.Asset || mongoose.model('Asset', assetSchema);
export default Asset;
