import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next, broadened from ".next/**" to
    // "**/.next/**" so a git worktree's own build output under
    // .claude/worktrees/<name>/.next (local-only, see .git/info/exclude)
    // doesn't get swept into a lint run from this checkout's root.
    "**/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code's own local tooling dir (worktrees, settings) — never
    // hand-written source.
    ".claude/**",
    // Emscripten-generated glue code (scripts/build-wasm.sh) — not hand-written.
    "public/wasm/**",
    // Prisma-generated client (`npx prisma generate`) — not hand-written.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
