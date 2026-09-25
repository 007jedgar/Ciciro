/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client", ".prisma/client", "@anthropic-ai/sdk"],
  // This project has its own lockfile; pin the tracing root to avoid Next.js
  // walking up to a parent lockfile in the home directory.
  outputFileTracingRoot: import.meta.dirname,
  experimental: {
    // Middleware runs on every request, and Next.js only buffers the first
    // 10 MB of a body that passes through it. /api/import accepts files up to
    // IMPORT_MAX_BYTES (20 MB, src/lib/import/index.ts) plus multipart
    // overhead, so leave room for that or larger uploads arrive truncated.
    middlewareClientMaxBodySize: "21mb",
  },
  // Emit a self-contained server for container/Node hosting (see Dockerfile).
  // Opt-in so the default local build output is unchanged; the Cloudflare path
  // uses OpenNext instead and ignores this.
  ...(process.env.CICIRO_STANDALONE === "true" ? { output: "standalone" } : {}),
};

export default nextConfig;
