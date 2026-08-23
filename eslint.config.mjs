import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Emscripten-generated glue code (scripts/build-wasm.sh) — not hand-written.
    "public/wasm/**",
    // Prisma-generated client (`npx prisma generate`) — not hand-written.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
