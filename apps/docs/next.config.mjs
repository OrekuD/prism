import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // The docs image (deploy/Dockerfile.docs) serves the standalone output.
  // Vercel's build pipeline expects the default output; standalone would
  // hide the trace file it reads (next-server.js.nft.json).
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
};

export default withMDX(config);
