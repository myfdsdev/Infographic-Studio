import mongoose from 'mongoose';

// Key/value application settings managed by the server and administrators
// (branding, feature flags, one-time markers such as the owner bootstrap).
const appSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 100 },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

appSettingsSchema.index({ key: 1 }, { unique: true });

export const AppSettings = mongoose.models.AppSettings || mongoose.model('AppSettings', appSettingsSchema);
export default AppSettings;
