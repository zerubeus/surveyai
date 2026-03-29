/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for OpenNext / Cloudflare Workers deployment
  output: "standalone",

  // Strict mode for catching bugs early
  reactStrictMode: true,

  // Skip ESLint during production build — TypeScript handles type safety.
  // Inline eslint-disable comments for @typescript-eslint/* rules cause
  // "rule not found" errors on hosts where the plugin isn't directly installed.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Image optimization for Supabase Storage
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/**',
      },
    ],
  },

  // Experimental features
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
