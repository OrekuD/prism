import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // The docs image (deploy/Dockerfile.docs) serves the standalone output.
  output: 'standalone',
};

export default withMDX(config);
