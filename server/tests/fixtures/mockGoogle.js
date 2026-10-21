// A local stand-in for Google's OAuth token endpoint and signing keys, so the
// "Sign in with Google" flow can be tested end to end without Google.
//
// Tests start a flow, read the state/nonce/PKCE challenge from the redirect to
// Google, register a one-time code with issueCode(), then call the callback.
// The token endpoint checks the client credentials, redirect URI and PKCE
// verifier like Google does, and returns an RS256 ID token signed with a key
// published at /certs.
import http from 'node:http';
import crypto from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

export const GOOGLE_TEST_CLIENT_ID = 'infographic-studio-test.apps.googleusercontent.com';
export const GOOGLE_TEST_CLIENT_SECRET = 'test-google-client-secret';

export async function startMockGoogle() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  // A key Google never published, for forged-token tests.
  const { privateKey: strangerKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key-1', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  const state = { tokenRequests: [], redirectUri: null };

  async function idToken(entry) {
    const claims = {
      iss: 'https://accounts.google.com',
      aud: GOOGLE_TEST_CLIENT_ID,
      email_verified: true,
      nonce: entry.nonce,
      ...entry.claims,
    };
    const key = entry.signWithStranger ? strangerKey : privateKey;
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuedAt()
      .setExpirationTime(entry.expired ? Math.floor(Date.now() / 1000) - 600 : '1h')
      .sign(key);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/certs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/token') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      state.tokenRequests.push(Object.fromEntries([...form].filter(([key]) => key !== 'client_secret')));
      const entry = codes.get(form.get('code'));
      codes.delete(form.get('code'));
      const challenge = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
      const ok =
        entry &&
        form.get('grant_type') === 'authorization_code' &&
        form.get('client_id') === GOOGLE_TEST_CLIENT_ID &&
        form.get('client_secret') === GOOGLE_TEST_CLIENT_SECRET &&
        (!state.redirectUri || form.get('redirect_uri') === state.redirectUri) &&
        challenge === entry.challenge;
      if (!ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'test-access-token', token_type: 'Bearer', expires_in: 3599, id_token: await idToken(entry) }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    url: base,
    state,
    /** Register a one-time authorization code for the flow in `authUrl`. */
    issueCode(authUrl, claims, options = {}) {
      const params = new URL(authUrl).searchParams;
      const code = crypto.randomBytes(12).toString('hex');
      codes.set(code, {
        challenge: params.get('code_challenge'),
        nonce: options.nonce ?? params.get('nonce'),
        claims,
        expired: options.expired,
        signWithStranger: options.signWithStranger,
      });
      return code;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
