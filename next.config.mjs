/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client", "@anthropic-ai/sdk"],
  // This project has its own lockfile; pin the tracing root to avoid Next.js
  // walking up to a parent lockfile in the home directory.
  outputFileTracingRoot: import.meta.dirname,
  // Emit a self-contained server for container/Node hosting (see Dockerfile).
  // Opt-in so the default local build output is unchanged; the Cloudflare path
  // uses OpenNext instead and ignores this.
  ...(process.env.CICIRO_STANDALONE === "true" ? { output: "standalone" } : {}),
};

export default nextConfig;
