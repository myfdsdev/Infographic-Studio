import mongoose from 'mongoose';

export const INFOGRAPHIC_STYLES = Object.freeze(['minimal', 'corporate', 'colorful', 'dark', 'pastel', 'sketch', 'isometric', 'retro', 'gradient']);
// Content structure. Records made before layouts existed have none and are
// treated as 'auto'.
export const INFOGRAPHIC_LAYOUTS = Object.freeze(['auto', 'list', 'steps', 'timeline', 'comparison', 'pros_cons', 'statistics', 'cycle', 'mindmap']);
// Ratios offered for new infographics (all native Z-Image sizes). 4:5 records
// made before the switch from Nano Banana stay valid.
export const INFOGRAPHIC_RATIOS = Object.freeze(['1:1', '3:4', '9:16']);
const STORED_RATIOS = Object.freeze([...INFOGRAPHIC_RATIOS, '4:5']);
export const INFOGRAPHIC_STATUSES = Object.freeze(['queued', 'processing', 'completed', 'failed', 'cancelled']);
export const INFOGRAPHIC_SOURCES = Object.freeze(['web', 'mcp']);

// One infographic request and its result. The image itself is produced by a
// GenerationJob (subjectType 'infographic') and, once finished, copied into
// private storage as an Asset so it outlives the provider's temporary URL.
const infographicSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    topic: { type: String, required: true, maxlength: 2000 },
    title: { type: String, required: true, maxlength: 120 },
    style: { type: String, enum: INFOGRAPHIC_STYLES, required: true },
    layout: { type: String, enum: INFOGRAPHIC_LAYOUTS, default: 'auto' },
    aspectRatio: { type: String, enum: STORED_RATIOS, required: true },
    model: { type: String, required: true },
    // The full prompt sent to the provider (no credentials).
    prompt: { type: String, required: true, maxlength: 20000 },
    source: { type: String, enum: INFOGRAPHIC_SOURCES, default: 'web' },
    regeneratedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Infographic', default: null },
    // How it was paid: platform credits (refunded once if it fails) or the
    // user's own key.
    billing: {
      source: { type: String, enum: ['user', 'platform'], default: 'user' },
      credits: { type: Number, default: 0 },
      refundedAt: { type: Date, default: null },
    },

    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'GenerationJob', required: true },
    status: { type: String, enum: INFOGRAPHIC_STATUSES, default: 'queued' },
    image: {
      assetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', default: null },
      width: { type: Number, default: null },
      height: { type: Number, default: null },
      mimeType: { type: String, default: null },
      size: { type: Number, default: null },
    },
    error: {
      code: { type: String, default: null },
      message: { type: String, default: null, maxlength: 1000 },
    },
    // Saving the finished image is claimed so two workers never store it twice.
    saving: {
      attempts: { type: Number, default: 0 },
      claimedUntil: { type: Date, default: null },
    },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

infographicSchema.index({ userId: 1, createdAt: -1 });
infographicSchema.index({ userId: 1, status: 1, createdAt: -1 });
infographicSchema.index({ jobId: 1 });
infographicSchema.index({ status: 1, updatedAt: 1 });

export const Infographic = mongoose.models.Infographic || mongoose.model('Infographic', infographicSchema);
export default Infographic;
