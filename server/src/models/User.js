import mongoose from 'mongoose';

export const USER_ROLES = Object.freeze(['user', 'admin']);
export const USER_STATUSES = Object.freeze(['active', 'suspended']);

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Never selected unless a query asks for it explicitly (+passwordHash).
    // Null for accounts made with Google that have not set a password.
    passwordHash: { type: String, default: null, select: false },
    // Sign in with Google: the Google account id ("sub", never changes) and
    // the address Google last reported for it.
    googleId: { type: String, default: null },
    googleEmail: { type: String, default: null, lowercase: true, trim: true, maxlength: 254 },
    role: { type: String, enum: USER_ROLES, default: 'user', required: true },
    status: { type: String, enum: USER_STATUSES, default: 'active', required: true },
    suspendedAt: { type: Date, default: null },
    suspendedReason: { type: String, default: null, maxlength: 500 },
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

userSchema.index({ email: 1 }, { unique: true });
// One AI Infographic Studio account per Google account; accounts without Google are not indexed.
userSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } });
userSchema.index({ role: 1, status: 1 });
userSchema.index({ createdAt: -1 });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;
