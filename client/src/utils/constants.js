import {
  Sparkles,
  Images,
  KeyRound,
  Plug,
  Settings,
  Shield,
  Gauge,
  Users,
  ImageIcon,
  Activity,
  AlertTriangle,
  Cpu,
  SlidersHorizontal,
  ScrollText,
  Terminal,
  Palette,
} from 'lucide-react';

export const APP_NAME = 'AI Infographic Studio';
export const APP_TAGLINE = 'Turn any topic into a clear, professional infographic';

// Built from client/public/Media/Logo.png: the full wordmark for headers, the
// square "Ai" mark for small slots, and the browser icon.
export const BRANDING = Object.freeze({
  wordmarkUrl: '/branding/logo-wordmark.png',
  logoUrl: '/branding/logo.png',
  faviconUrl: '/branding/favicon-32.png',
  touchIconUrl: '/branding/favicon.png',
});

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

export const ROUTES = Object.freeze({
  login: '/login',
  signup: '/signup',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  dashboard: '/',
  create: '/',
  generations: '/generations',
  generation: (id) => `/generations/${id}`,
  apiSettings: '/settings/api',
  mcp: '/mcp',
  account: '/settings/account',
  admin: '/admin',
  adminOverview: '/admin/overview',
  adminUsers: '/admin/users',
  adminUser: (id) => `/admin/users/${id}`,
  adminGenerations: '/admin/generations',
  adminJobs: '/admin/jobs',
  adminFailures: '/admin/failures',
  adminMcp: '/admin/mcp',
  adminProviders: '/admin/providers',
  adminAccess: '/admin/access',
  adminAuditLogs: '/admin/audit-logs',
  adminOperations: '/admin/operations',
  adminBranding: '/admin/branding',
});

// Top navigation tabs (desktop). Admin is added for admins only.
export const TOP_NAV = Object.freeze([
  { key: 'create', label: 'Studio', to: ROUTES.create, icon: Sparkles, end: true },
  { key: 'generations', label: 'Generations', to: ROUTES.generations, icon: Images },
  { key: 'api', label: 'API Key', to: ROUTES.apiSettings, icon: KeyRound },
  { key: 'mcp', label: 'MCP', to: ROUTES.mcp, icon: Plug },
]);

export const ADMIN_TOP_NAV = Object.freeze({ key: 'admin', label: 'Admin', to: ROUTES.admin, icon: Shield });

// Mobile drawer, grouped by intent. Administration is added for admins only.
export const NAV_SECTIONS = Object.freeze([
  {
    key: 'workspace',
    title: 'Workspace',
    items: [
      { key: 'create', label: 'Create Infographic', to: ROUTES.create, icon: Sparkles, end: true },
      { key: 'generations', label: 'My Generations', to: ROUTES.generations, icon: Images },
    ],
  },
  {
    key: 'connections',
    title: 'Connections',
    items: [
      { key: 'api', label: 'API Settings', to: ROUTES.apiSettings, icon: KeyRound },
      { key: 'mcp', label: 'MCP Connection', to: ROUTES.mcp, icon: Plug },
    ],
  },
  {
    key: 'account',
    title: 'Account',
    items: [{ key: 'settings', label: 'Settings', to: ROUTES.account, icon: Settings }],
  },
]);

export const ADMIN_NAV_SECTION = Object.freeze({
  key: 'administration',
  title: 'Administration',
  items: [{ key: 'admin', label: 'Admin Panel', to: ROUTES.admin, icon: Shield }],
});

// Page titles shown in the top header.
export const PAGE_TITLES = Object.freeze([
  { match: (path) => path === '/', title: 'Create Infographic' },
  { match: (path) => path.startsWith('/generations/'), title: 'Infographic' },
  { match: (path) => path.startsWith('/generations'), title: 'My Generations' },
  { match: (path) => path.startsWith('/settings/api'), title: 'API Settings' },
  { match: (path) => path.startsWith('/mcp'), title: 'MCP Connection' },
  { match: (path) => path.startsWith('/settings/account'), title: 'Settings' },
  { match: (path) => path.startsWith('/admin'), title: 'Admin Panel' },
]);

export function pageTitleFor(pathname) {
  return PAGE_TITLES.find((entry) => entry.match(pathname))?.title || APP_NAME;
}

// Admin sections, shown as one horizontal navigation bar.
export const ADMIN_TABS = Object.freeze([
  { key: 'overview', label: 'Overview', to: ROUTES.adminOverview, icon: Gauge },
  { key: 'users', label: 'Users', to: ROUTES.adminUsers, icon: Users },
  { key: 'generations', label: 'Generations', to: ROUTES.adminGenerations, icon: ImageIcon },
  { key: 'jobs', label: 'Jobs', to: ROUTES.adminJobs, icon: Activity },
  { key: 'failures', label: 'Failures', to: ROUTES.adminFailures, icon: AlertTriangle },
  { key: 'mcp', label: 'MCP', to: ROUTES.adminMcp, icon: Plug },
  { key: 'providers', label: 'Provider', to: ROUTES.adminProviders, icon: Cpu },
  { key: 'access', label: 'Access', to: ROUTES.adminAccess, icon: SlidersHorizontal },
  { key: 'audit', label: 'Audit Logs', to: ROUTES.adminAuditLogs, icon: ScrollText },
  { key: 'operations', label: 'Operations', to: ROUTES.adminOperations, icon: Terminal },
  { key: 'branding', label: 'Branding', to: ROUTES.adminBranding, icon: Palette },
]);

// Infographic options. The server is the source of truth (GET
// /api/infographics/options); these mirror it so the form renders at once.
export const INFOGRAPHIC_STYLES = Object.freeze([
  { value: 'minimal', label: 'Minimal', description: 'Simple layout, clean type, neutral colours.' },
  { value: 'corporate', label: 'Corporate', description: 'Structured sections, clear icons and diagrams.' },
  { value: 'colorful', label: 'Colorful', description: 'Vibrant, friendly illustrations, bold hierarchy.' },
]);

export const INFOGRAPHIC_RATIOS = Object.freeze([
  { value: '1:1', label: 'Square', w: 1, h: 1 },
  { value: '3:4', label: 'Portrait', w: 3, h: 4 },
  { value: '9:16', label: 'Vertical', w: 9, h: 16 },
]);

export const TOPIC_MIN = 10;
// Z-Image takes at most 1000 prompt characters, so the topic is capped lower.
export const TOPIC_MAX = 400;
// Ratios offered before the switch to Z-Image, mapped to the closest one now.
export const LEGACY_RATIOS = Object.freeze({ '4:5': '3:4' });
export const TOPIC_PLACEHOLDER = 'Create an infographic explaining 5 benefits of AI automation for small businesses.';

export const INFOGRAPHIC_STATUSES = Object.freeze({
  queued: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'Generating', tone: 'info' },
  completed: { label: 'Ready', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
});

export const PROVIDER = Object.freeze({
  key: 'kie',
  name: 'Kie.ai',
  product: 'Z-Image',
  docsUrl: 'https://docs.kie.ai',
  keyPageUrl: 'https://kie.ai/api-key',
});

export const JOB_STATUSES = Object.freeze({
  queued: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
});

export const JOB_KINDS = Object.freeze({
  image: 'Image',
});

export const CREDENTIAL_STATUSES = Object.freeze({
  valid: { label: 'Connected', tone: 'ok' },
  unverified: { label: 'Saved, not verified', tone: 'warning' },
  invalid: { label: 'Key rejected', tone: 'danger' },
});

// What the user can do about a failed generation. `to` is an in-app route,
// `href` an external page.
export const JOB_ERROR_HELP = Object.freeze({
  NO_API_KEY: { text: 'Connect your own Kie.ai API key, then generate again.', action: 'Open API Settings', to: '/settings/api' },
  API_KEY_INVALID: { text: 'Kie.ai rejected your saved key. Replace it, then generate again.', action: 'Open API Settings', to: '/settings/api' },
  PROVIDER_KEY_REJECTED: { text: 'Kie.ai refused your key. Replace it, then generate again.', action: 'Open API Settings', to: '/settings/api' },
  KEY_UNREADABLE: { text: 'Your saved key can no longer be read. Save it again.', action: 'Open API Settings', to: '/settings/api' },
  INSUFFICIENT_CREDITS: { text: 'Your Kie.ai account is out of credits. Top it up, then generate again.', action: 'Open Kie.ai', href: 'https://kie.ai' },
  INVALID_REQUEST: { text: 'Kie.ai rejected the request. Reword the topic and try again.' },
  PROVIDER_GENERATION_FAILED: { text: 'Kie.ai could not make this image, often because of its content rules. Reword the topic and try again.' },
  MODEL_DISABLED: { text: 'Image generation is switched off by the administrator right now.' },
  GENERATION_PAUSED: { text: 'Generation is paused by the administrator. Try again later.' },
  RATE_LIMITED: { text: 'Kie.ai is limiting requests. Wait a minute and try again.' },
  PROVIDER_UNAVAILABLE: { text: 'Kie.ai is under maintenance. Try again later.' },
  SUBMISSION_UNCERTAIN: { text: 'Check the task logs in your Kie.ai dashboard first: if the image was made there, generating again would charge you twice.', action: 'Open Kie.ai', href: 'https://kie.ai' },
  TIMEOUT: { text: 'Kie.ai took too long. Check the task logs in your Kie.ai dashboard before trying again.', action: 'Open Kie.ai', href: 'https://kie.ai' },
  RESULT_DOWNLOAD_FAILED: { text: 'The image was made but could not be fetched from Kie.ai. Generate it again.' },
  RESULT_SAVE_FAILED: { text: 'The image was made but could not be saved. Generate it again.' },
});

export const STATUS_POLL_INTERVAL_MS = 15000;
export const JOB_POLL_INTERVAL_MS = 3000;

export const PREVIEW_STORAGE_KEY = 'infographic_studio_ui_preview';
