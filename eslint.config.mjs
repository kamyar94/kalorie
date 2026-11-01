import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The service worker and plain Node scripts are not part of the Next.js bundle.
    files: ["public/sw.js", "scripts/**/*.mjs"],
    rules: { "@next/next/no-assign-module-variable": "off" },
  },
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "out/**",
    "dist/**",
    "next-env.d.ts",
    ".worktrees/**",
    ".build-notes/**",
    "drizzle/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);
