import mongoose from 'mongoose';

export const AUDIT_AREAS = Object.freeze(['auth', 'account', 'admin', 'mcp', 'system']);

// Append-only record of security-relevant actions. Metadata is scrubbed of
// anything that looks like a secret before it is written (see audit.service).
const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorEmail: { type: String, default: null },
    actorRole: { type: String, default: null },
    action: { type: String, required: true },
    area: { type: String, enum: AUDIT_AREAS, required: true },
    outcome: { type: String, enum: ['success', 'failure'], default: 'success' },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    targetEmail: { type: String, default: null },
    summary: { type: String, default: null, maxlength: 500 },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ area: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ targetId: 1, createdAt: -1 });

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
