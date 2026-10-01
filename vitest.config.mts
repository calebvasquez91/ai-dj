import path from "path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // Vitest's own defaults don't cover .claude/ — a git worktree's full
    // source copy can live under .claude/worktrees/<name>/ (local-only,
    // see .git/info/exclude), and without this its test files get
    // collected a second time alongside this checkout's own, running
    // against the worktree's copy of the code (seen failing for reasons
    // specific to that checkout, e.g. missing env/mocked state) even
    // though the real suite already passed.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
