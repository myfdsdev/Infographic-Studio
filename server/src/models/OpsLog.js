import mongoose from 'mongoose';

export const OPS_LEVELS = Object.freeze(['warn', 'error', 'fatal']);

// Warnings and errors from the server log, kept for administrators for 14
// days. Entries are copied from the logger output after its redaction and are
// redacted again (utils/redact.js) before they are stored.
const opsLogSchema = new mongoose.Schema(
  {
    level: { type: String, enum: OPS_LEVELS, required: true },
    message: { type: String, default: '', maxlength: 600 },
    context: { type: mongoose.Schema.Types.Mixed, default: null },
    instance: { type: String, default: null, maxlength: 100 },
    at: { type: Date, required: true },
  },
  { versionKey: false },
);

opsLogSchema.index({ at: -1 });
opsLogSchema.index({ level: 1, at: -1 });
opsLogSchema.index({ at: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60, name: 'at_ttl' });

export const OpsLog = mongoose.models.OpsLog || mongoose.model('OpsLog', opsLogSchema);
export default OpsLog;
