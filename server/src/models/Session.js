import mongoose from 'mongoose';

// One row per signed-in browser. The cookie holds a random token; this row
// holds its HMAC so the session can be looked up and revoked server-side.
const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    persistent: { type: Boolean, default: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    // Set while an administrator views the app as another user ("Act as
    // user", services/actAs.service.js). Requests on this session then run as
    // that user, read-only, until expiresAt.
    actingAs: {
      type: new mongoose.Schema(
        {
          userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
          startedAt: { type: Date, required: true },
          expiresAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ userId: 1, revokedAt: 1 });
// MongoDB deletes expired sessions automatically.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
export default Session;
