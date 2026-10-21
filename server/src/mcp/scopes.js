// OAuth scopes for the AI Infographic Studio MCP server. They are shown on the
// consent page, where the user can leave out the one that spends provider credits.

export const SCOPES = Object.freeze([
  {
    id: 'infographics:read',
    label: 'See your infographics',
    description: 'List your infographics, read their details and check generation status.',
    paid: false,
  },
  {
    id: 'infographics:write',
    label: 'Generate infographics',
    description: 'Start new infographics. Each one is a paid generation on your own Kie.ai account.',
    paid: true,
  },
]);

export const SCOPE_IDS = Object.freeze(SCOPES.map((scope) => scope.id));
export const READ_SCOPES = Object.freeze(SCOPES.filter((scope) => !scope.paid).map((scope) => scope.id));

/** Keep only known scopes, in the canonical order. */
export function normalizeScopes(values) {
  const wanted = new Set(Array.isArray(values) ? values : String(values || '').split(' '));
  return SCOPE_IDS.filter((id) => wanted.has(id));
}

export function describeScopes(ids) {
  const wanted = new Set(ids);
  return SCOPES.filter((scope) => wanted.has(scope.id));
}
