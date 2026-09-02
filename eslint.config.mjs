import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // src/worker is a separate Cloudflare build target (tsconfig.worker.json),
    // bundled by wrangler/esbuild, not by Next.js.
    ignores: [
      "src/generated/**",
      ".next/**",
      "node_modules/**",
      ".open-next/**",
      "src/worker/**",
      "apps/**",
    ],
  },
];

export default eslintConfig;
