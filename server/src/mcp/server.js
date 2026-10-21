// The MCP server: one McpServer instance per HTTP request (the SDK's
// stateless model), built for the authenticated user of that request.
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { logger } from '../config/logger.js';
import { registerTools } from './tools.js';
import { getBranding } from '../services/branding.service.js';
import pkg from '../../package.json' with { type: 'json' };

const INSTRUCTIONS = [
  "AI Infographic Studio turns a topic into a professional infographic image with Z-Image (Kie.ai), using the user's own Kie.ai API key.",
  "Typical flow: generate_infographic (topic, style minimal|corporate|colorful, aspect_ratio 1:1|3:4|9:16) -> get_generation_status every 15-30 seconds until completed -> the user views or downloads it at web_url.",
  "generate_infographic spends the user's Kie.ai credits: describe what will be generated and get the user's agreement first, then pass confirm_paid_generation: true.",
  "list_infographics and get_infographic read the user's history. Only the signed-in user's own infographics are ever returned.",
].join(' ');

/** Request details for audit entries written by tools (ip, user agent). */
function requestMetaFrom(authInfo) {
  const ip = authInfo?.extra?.ip || null;
  const userAgent = authInfo?.extra?.userAgent || null;
  return { ip, get: (name) => (String(name).toLowerCase() === 'user-agent' ? userAgent : undefined) };
}

export async function buildMcpServer(authInfo) {
  const { appName } = await getBranding();
  const server = new McpServer(
    { name: 'ai-infographic-studio', title: appName, version: pkg.version },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, authInfo, requestMetaFrom(authInfo));
  return server;
}

export function createStudioMcpHandler() {
  return createMcpHandler((ctx) => buildMcpServer(ctx.authInfo), {
    onerror: (error) => logger.warn({ reason: error.message }, 'MCP request rejected'),
  });
}
