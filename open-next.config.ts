import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Adapts the Next.js build for Cloudflare Workers. Defaults are sufficient for
// Ciciro; incremental cache / tag cache can be wired to KV or R2 later.
export default defineCloudflareConfig();
