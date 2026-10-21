// Access-token check for every MCP request (the SDK's bearer middleware calls
// verifyAccessToken). A token is accepted only when all of these hold:
//   - it exists in the authorization server's store and has not expired
//   - its audience is exactly this MCP endpoint (RFC 8707); tokens for any
//     other resource are refused, so no token is passed through or reused
//   - the connection (grant) it belongs to is still active (revoke = instant)
//   - the account is active (suspension blocks MCP like browser sessions)
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { env } from '../config/env.js';
import { McpConnection } from '../models/McpConnection.js';
import { User } from '../models/User.js';
import { getOAuthProvider } from './oauthServer.js';

function invalid(message) {
  return new OAuthError(OAuthErrorCode.InvalidToken, message);
}

export const tokenVerifier = {
  async verifyAccessToken(token) {
    const provider = await getOAuthProvider();
    const accessToken = await provider.AccessToken.find(token);
    if (!accessToken) throw invalid('The access token is invalid, expired or revoked');
    if (accessToken.aud !== env.mcpResourceUrl) throw invalid('The access token was not issued for this MCP server');

    const connection = await McpConnection.findOne({ grantId: accessToken.grantId }).lean();
    if (!connection || connection.status !== 'active' || String(connection.userId) !== String(accessToken.accountId)) {
      throw invalid('This connection was revoked. Connect the app again.');
    }
    const user = await User.findById(accessToken.accountId).select('status').lean();
    if (!user || user.status !== 'active') throw invalid('The AI Infographic Studio account is not active');

    return {
      token,
      clientId: accessToken.clientId,
      scopes: accessToken.scope ? accessToken.scope.split(' ').filter(Boolean) : [],
      expiresAt: accessToken.exp,
      resource: new URL(env.mcpResourceUrl),
      extra: {
        userId: String(accessToken.accountId),
        connectionId: String(connection._id),
        clientName: connection.clientName || null,
      },
    };
  },
};
