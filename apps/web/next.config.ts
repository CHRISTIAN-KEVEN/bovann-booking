import type { NextConfig } from 'next';

/** Where the website forwards `/api/*` (server side). Same machine by default. */
const API_PROXY_TARGET = (process.env.API_PROXY_TARGET ?? 'http://localhost:3001').replace(
  /\/$/,
  '',
);

/**
 * Extra host names allowed to load the dev server's scripts, for tunnels such as ngrok
 * (Next.js only serves them to localhost by default). Development only; comma-separated.
 */
const DEV_ALLOWED_ORIGINS = (
  process.env.DEV_ALLOWED_ORIGINS ?? '*.ngrok-free.app,*.ngrok-free.dev,*.ngrok.app,*.ngrok.io'
)
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production Docker image (Phase 8).
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@bovann/shared'],
  allowedDevOrigins: DEV_ALLOWED_ORIGINS,
  /**
   * The browser calls the API on the website's own address (`/api/...`) and the website forwards
   * it. One address to share (a tunnel, a domain), no CORS, and the admin session cookie stays
   * first-party.
   */
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_PROXY_TARGET}/api/:path*` }];
  },
};

export default nextConfig;
