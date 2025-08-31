import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/deployments/:id/:path*',
        destination: '/deployments/:id/:path*',
      },
    ];
  },
};

export default nextConfig;
