import mongoose from 'mongoose';

// A sign-up link that gives new accounts free platform credits:
//   <CLIENT_URL>/signup?bonus=<code>
// Only accounts created through the link receive the credits. `uses` and
// `creditsGranted` are increased atomically when a sign-up claims the link,
// so `maxUses` is never exceeded even with simultaneous sign-ups.
const bonusLinkSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    credits: { type: Number, required: true, min: 1, max: 100000 },
    // null = unlimited.
    maxUses: { type: Number, default: null, min: 1 },
    expiresAt: { type: Date, default: null },
    enabled: { type: Boolean, default: true },
    uses: { type: Number, default: 0 },
    creditsGranted: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);

bonusLinkSchema.index({ code: 1 }, { unique: true });
bonusLinkSchema.index({ createdAt: -1 });

export const BonusLink = mongoose.models.BonusLink || mongoose.model('BonusLink', bonusLinkSchema);
export default BonusLink;
