import mongoose from 'mongoose';

export const CREDIT_REASONS = Object.freeze(['bonus_signup', 'generation', 'refund', 'admin_adjustment']);

// Ledger of every change to a user's platform credits. The balance itself
// lives on the User (updated atomically); this keeps the history behind it.
// Amounts are signed: grants and refunds are positive, spending is negative.
const creditTransactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, default: null },
    reason: { type: String, enum: CREDIT_REASONS, required: true },
    note: { type: String, default: null, maxlength: 300 },
    infographicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Infographic', default: null },
    bonusLinkId: { type: mongoose.Schema.Types.ObjectId, ref: 'BonusLink', default: null },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

creditTransactionSchema.index({ userId: 1, createdAt: -1 });
creditTransactionSchema.index({ bonusLinkId: 1, createdAt: -1 });

export const CreditTransaction = mongoose.models.CreditTransaction || mongoose.model('CreditTransaction', creditTransactionSchema);
export default CreditTransaction;
