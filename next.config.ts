import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output for Docker/Cloud Run deployment
  output: 'standalone',
  // 允許 Server Actions
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
