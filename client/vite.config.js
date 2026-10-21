import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Link-preview tags in index.html need absolute URLs (WhatsApp, Facebook and
// LinkedIn ignore relative ones): %SITE_URL% becomes VITE_SITE_URL, the app's
// public address such as https://app.example.com. Without it the paths stay
// relative, which is fine for local development.
function siteUrl(value) {
  const url = String(value || '').trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\/[^/\s]+$/i.test(url)) {
    throw new Error(`VITE_SITE_URL must be an http(s) address without a path, got "${value}"`);
  }
  return {
    name: 'studio-site-url',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', url),
  };
}

// AI Infographic Studio client build configuration.
// In development, every request to /api is proxied to the Express backend so the
// browser never talks to a different origin (cookies and CORS stay simple).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxyTarget = env.VITE_DEV_API_PROXY || 'http://localhost:5000';
  const devPort = Number(env.VITE_DEV_PORT) || 5173;

  return {
    plugins: [react(), siteUrl(env.VITE_SITE_URL)],
    server: {
      port: devPort,
      strictPort: false,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      emptyOutDir: true,
    },
  };
});
