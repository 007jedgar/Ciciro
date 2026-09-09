import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/apps/**", "**/dist/**"],
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});
