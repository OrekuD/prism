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
    // Legacy documentation paths redirect to the simplified structure
    // (research/simplified-docs-structure.md). Every chain terminates on a
    // live destination — legacy chains are re-pointed directly.
    return [
      // Pre-restructure chains, re-pointed to the new tree.
      { source: '/docs/start/:path*', destination: '/docs/start/quickstart', permanent: true },
      { source: '/docs/hosted/quickstart', destination: '/docs/start/quickstart', permanent: true },
      { source: '/docs/hosted/authentication', destination: '/docs/configuration/projects-sources-and-keys', permanent: true },
      { source: '/docs/product/events', destination: '/docs/features/capturing-events', permanent: true },
      { source: '/docs/product/realtime', destination: '/docs/features/sessions-and-live-activity', permanent: true },
      { source: '/docs/product/:path*', destination: '/docs/configuration/projects-sources-and-keys', permanent: true },
      { source: '/docs/sdks/javascript', destination: '/docs/start/javascript-sdk', permanent: true },
      { source: '/docs/sdks/react', destination: '/docs/start/react-sdk', permanent: true },
      { source: '/docs/sdks/events', destination: '/docs/features/capturing-events', permanent: true },
      { source: '/docs/sdks/sessions', destination: '/docs/features/sessions-and-live-activity', permanent: true },
      { source: '/docs/sdks/identity', destination: '/docs/features/identifying-users', permanent: true },
      { source: '/docs/sdks/consent', destination: '/docs/configuration/consent-and-privacy', permanent: true },
      { source: '/docs/sdks/adapters', destination: '/docs/reference/sdk-api-and-limits', permanent: true },
      { source: '/docs/api-reference/core', destination: '/docs/reference/sdk/core', permanent: true },
      { source: '/docs/api-reference/:path*', destination: '/docs/reference/sdk-api-and-limits', permanent: true },
      { source: '/docs/operations/privacy', destination: '/docs/configuration/consent-and-privacy', permanent: true },
      { source: '/docs/operations/security', destination: '/docs/configuration/consent-and-privacy', permanent: true },
      { source: '/docs/operations/mail', destination: '/docs/self-hosting/configure-and-operate', permanent: true },
      { source: '/docs/operations/networking', destination: '/docs/self-hosting/configure-and-operate', permanent: true },
      { source: '/docs/operations/health', destination: '/docs/self-hosting/configure-and-operate', permanent: true },
      { source: '/docs/operations/logging', destination: '/docs/self-hosting/configure-and-operate', permanent: true },

      // 2026-08 simplification (8 sections / 68 pages -> 5 groups / 15 pages).
      { source: '/docs/getting-started/overview', destination: '/docs/start/quickstart', permanent: true },
      { source: '/docs/getting-started/concepts', destination: '/docs/start/quickstart', permanent: true },
      { source: '/docs/getting-started/hosted-quickstart', destination: '/docs/start/quickstart', permanent: true },
      { source: '/docs/getting-started/choose-deployment', destination: '/docs/self-hosting/self-host-prism', permanent: true },
      { source: '/docs/getting-started/self-hosted-quickstart', destination: '/docs/self-hosting/install-prism', permanent: true },
      { source: '/docs/getting-started/:path*', destination: '/docs/start/quickstart', permanent: true },
      { source: '/docs/analytics/overview', destination: '/docs/start/quickstart', permanent: true },
      { source: '/docs/analytics/events', destination: '/docs/features/capturing-events', permanent: true },
      { source: '/docs/analytics/metrics', destination: '/docs/features/capturing-events', permanent: true },
      { source: '/docs/analytics/web-analytics', destination: '/docs/features/page-analytics', permanent: true },
      { source: '/docs/analytics/people', destination: '/docs/features/identifying-users', permanent: true },
      { source: '/docs/analytics/sessions-realtime', destination: '/docs/features/sessions-and-live-activity', permanent: true },
      { source: '/docs/analytics/:path*', destination: '/docs/features/capturing-events', permanent: true },
      { source: '/docs/tracking/events', destination: '/docs/features/capturing-events', permanent: true },
      { source: '/docs/tracking/global-properties', destination: '/docs/features/capturing-events', permanent: true },
      { source: '/docs/tracking/identity', destination: '/docs/features/identifying-users', permanent: true },
      { source: '/docs/tracking/sessions', destination: '/docs/features/sessions-and-live-activity', permanent: true },
      { source: '/docs/tracking/consent', destination: '/docs/configuration/consent-and-privacy', permanent: true },
      { source: '/docs/tracking/delivery', destination: '/docs/configuration/delivery-and-diagnostics', permanent: true },
      { source: '/docs/tracking/runtime-adapters', destination: '/docs/reference/sdk-api-and-limits', permanent: true },
      { source: '/docs/tracking/overview', destination: '/docs/start/quickstart', permanent: true },
      { source: '/docs/tracking/web/javascript-browser', destination: '/docs/start/javascript-sdk', permanent: true },
      { source: '/docs/tracking/web/react', destination: '/docs/start/react-sdk', permanent: true },
      { source: '/docs/tracking/:path*', destination: '/docs/features/capturing-events', permanent: true },
      { source: '/docs/management/:path*', destination: '/docs/configuration/projects-sources-and-keys', permanent: true },
      { source: '/docs/privacy-security/data-collection', destination: '/docs/configuration/consent-and-privacy', permanent: true },
      { source: '/docs/privacy-security/consent-identity', destination: '/docs/features/identifying-users', permanent: true },
      { source: '/docs/privacy-security/person-data', destination: '/docs/features/identifying-users', permanent: true },
      { source: '/docs/privacy-security/retention', destination: '/docs/configuration/consent-and-privacy', permanent: true },
      { source: '/docs/privacy-security/security-model', destination: '/docs/configuration/consent-and-privacy', permanent: true },
      { source: '/docs/privacy-security/:path*', destination: '/docs/configuration/consent-and-privacy', permanent: true },
      { source: '/docs/self-hosting/overview', destination: '/docs/self-hosting/self-host-prism', permanent: true },
      { source: '/docs/self-hosting/requirements', destination: '/docs/self-hosting/install-prism', permanent: true },
      { source: '/docs/self-hosting/architecture', destination: '/docs/self-hosting/self-host-prism', permanent: true },
      { source: '/docs/self-hosting/installation', destination: '/docs/self-hosting/install-prism', permanent: true },
      { source: '/docs/self-hosting/first-boot', destination: '/docs/self-hosting/install-prism', permanent: true },
      { source: '/docs/self-hosting/configuration/:path*', destination: '/docs/self-hosting/configure-and-operate', permanent: true },
      { source: '/docs/self-hosting/operations/:path*', destination: '/docs/self-hosting/configure-and-operate', permanent: true },
      { source: '/docs/self-hosting/troubleshooting', destination: '/docs/self-hosting/configure-and-operate', permanent: true },
      { source: '/docs/self-hosting/operating/:path*', destination: '/docs/self-hosting/configure-and-operate', permanent: true },
      { source: '/docs/self-hosting/reference/:path*', destination: '/docs/self-hosting/self-host-prism', permanent: true },
      { source: '/docs/self-hosting/evaluation/:path*', destination: '/docs/self-hosting/self-host-prism', permanent: true },
      { source: '/docs/reference/limits', destination: '/docs/reference/sdk-api-and-limits', permanent: true },
      { source: '/docs/reference/api/ingestion', destination: '/docs/configuration/delivery-and-diagnostics', permanent: true },
      { source: '/docs/reference/api/realtime', destination: '/docs/features/sessions-and-live-activity', permanent: true },
      { source: '/docs/reference/api/management', destination: '/docs/reference/sdk-api-and-limits', permanent: true },
      { source: '/docs/reference/api/analytics-queries', destination: '/docs/reference/sdk-api-and-limits', permanent: true },
      { source: '/docs/reference/api/errors', destination: '/docs/features/error-tracking', permanent: true },
      { source: '/docs/reference/api/:path*', destination: '/docs/reference/sdk-api-and-limits', permanent: true },
      { source: '/docs/contributing/:path*', destination: '/docs/reference/sdk-api-and-limits', permanent: true },
    ];
  },
};

export default withMDX(config);
