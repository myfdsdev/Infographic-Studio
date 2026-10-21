import mongoose from 'mongoose';

export const CONNECTION_STATUSES = Object.freeze(['active', 'revoked']);
export const REGISTRATION_TYPES = Object.freeze(['metadata_document', 'dynamic', 'unknown']);

// One AI client a user approved on the consent page. It owns exactly one
// OAuth grant: every access and refresh token issued for the connection
// carries that grant id, so revoking the connection revokes them all. Token
// checks read `status` on every MCP request, so a revoke takes effect at once.
const mcpConnectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: String, required: true, maxlength: 2048 },
    clientName: { type: String, default: null, maxlength: 200 },
    clientUri: { type: String, default: null, maxlength: 2048 },
    registration: { type: String, enum: REGISTRATION_TYPES, default: 'unknown' },
    // Hosts the client may send the user back to (shown on the consent page).
    redirectHosts: { type: [String], default: [] },
    grantId: { type: String, required: true },
    scopes: { type: [String], default: [] },
    status: { type: String, enum: CONNECTION_STATUSES, default: 'active' },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null, maxlength: 60 },
    lastUsedAt: { type: Date, default: null },
    lastTool: { type: String, default: null, maxlength: 60 },
  },
  { timestamps: true, versionKey: false },
);

mcpConnectionSchema.index({ grantId: 1 }, { unique: true });
mcpConnectionSchema.index({ userId: 1, status: 1, createdAt: -1 });

export const McpConnection = mongoose.models.McpConnection || mongoose.model('McpConnection', mcpConnectionSchema);
export default McpConnection;
