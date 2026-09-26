import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // tsconfig keeps JSX for Next.js; compile it here so tests can render components.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/apps/**", "**/dist/**", "**/.worktrees/**"],
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});
