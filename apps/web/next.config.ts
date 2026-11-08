import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production Docker image (Phase 8).
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@bovann/shared'],
};

export default nextConfig;
