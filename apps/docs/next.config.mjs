import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // The docs image (deploy/Dockerfile.docs) serves the standalone output.
  output: 'standalone',
  // Old documentation paths redirect to their new destinations
  // (docs-structure.md migration map). The web app, homepage, repository
  // README, and existing content may still link the legacy routes.
  async redirects() {
    return [
      { source: '/docs/start/:path*', destination: '/docs/getting-started/:path*', permanent: true },
      { source: '/docs/hosted/quickstart', destination: '/docs/getting-started/hosted-quickstart', permanent: true },
      { source: '/docs/hosted/authentication', destination: '/docs/management/authentication', permanent: true },
      { source: '/docs/product/events', destination: '/docs/analytics/events', permanent: true },
      { source: '/docs/product/realtime', destination: '/docs/analytics/sessions-realtime', permanent: true },
      { source: '/docs/product/:path*', destination: '/docs/management/:path*', permanent: true },
      { source: '/docs/sdks/javascript', destination: '/docs/tracking/web/javascript-browser', permanent: true },
      { source: '/docs/sdks/react', destination: '/docs/tracking/web/react', permanent: true },
      { source: '/docs/sdks/events', destination: '/docs/tracking/events', permanent: true },
      { source: '/docs/sdks/sessions', destination: '/docs/tracking/sessions', permanent: true },
      { source: '/docs/sdks/identity', destination: '/docs/tracking/identity', permanent: true },
      { source: '/docs/sdks/consent', destination: '/docs/tracking/consent', permanent: true },
      { source: '/docs/sdks/adapters', destination: '/docs/tracking/runtime-adapters', permanent: true },
      { source: '/docs/api-reference/core', destination: '/docs/reference/sdk/core', permanent: true },
      { source: '/docs/api-reference/:path*', destination: '/docs/reference/api/:path*', permanent: true },
      { source: '/docs/operations/privacy', destination: '/docs/privacy-security/data-collection', permanent: true },
      { source: '/docs/operations/security', destination: '/docs/privacy-security/security-model', permanent: true },
      { source: '/docs/operations/mail', destination: '/docs/self-hosting/configuration/email', permanent: true },
      { source: '/docs/operations/networking', destination: '/docs/self-hosting/configuration/networking', permanent: true },
      { source: '/docs/operations/health', destination: '/docs/self-hosting/operations/health', permanent: true },
      { source: '/docs/operations/logging', destination: '/docs/self-hosting/operations/logging', permanent: true },
      { source: '/docs/self-hosting/evaluation/:path*', destination: '/docs/self-hosting/:path*', permanent: true },
      { source: '/docs/self-hosting/operating/configuration', destination: '/docs/self-hosting/configuration/environment-variables', permanent: true },
      { source: '/docs/self-hosting/operating/storage', destination: '/docs/self-hosting/configuration/file-storage', permanent: true },
      { source: '/docs/self-hosting/operating/reverse-proxy', destination: '/docs/self-hosting/configuration/domains-tls', permanent: true },
      { source: '/docs/self-hosting/operating/:path*', destination: '/docs/self-hosting/operations/:path*', permanent: true },
      { source: '/docs/self-hosting/reference/:path*', destination: '/docs/self-hosting/:path*', permanent: true },
    ];
  },
};

export default withMDX(config);
