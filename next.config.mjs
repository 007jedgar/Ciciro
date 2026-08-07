/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client", "@anthropic-ai/sdk"],
  // This project has its own lockfile; pin the tracing root to avoid Next.js
  // walking up to a parent lockfile in the home directory.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
