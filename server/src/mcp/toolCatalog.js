// The MCP tools, the scope each one needs, and whether it spends provider
// credits. Used by the server, the consent page and the MCP Connection page.

export const TOOLS = Object.freeze([
  {
    name: 'generate_infographic',
    title: 'Generate an infographic',
    description: 'Create an infographic from a topic, a visual style and an aspect ratio, on your own Kie.ai key.',
    scopes: ['infographics:write'],
    paid: true,
  },
  {
    name: 'get_generation_status',
    title: 'Check generation status',
    description: 'Status of an infographic generation, with image details when it is ready.',
    scopes: ['infographics:read'],
    paid: false,
  },
  {
    name: 'list_infographics',
    title: 'List infographics',
    description: 'Your generation history, newest first.',
    scopes: ['infographics:read'],
    paid: false,
  },
  {
    name: 'get_infographic',
    title: 'Get an infographic',
    description: 'Full details of one of your infographics.',
    scopes: ['infographics:read'],
    paid: false,
  },
]);

export const TOOL_SUMMARIES = TOOLS.map(({ name, title, description, scopes, anyScope, paid }) => ({
  name,
  title,
  description,
  scopes,
  anyScope: Boolean(anyScope),
  paid,
}));

export function toolByName(name) {
  return TOOLS.find((tool) => tool.name === name) || null;
}
