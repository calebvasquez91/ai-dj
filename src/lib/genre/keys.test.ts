import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every .ts/.tsx file under src (not generated code), as [path, text]. */
function sourceFiles(dir = "src"): [string, string][] {
  const out: [string, string][] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (full.replace(/\\/g, "/").includes("/generated")) continue;
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push([full.replace(/\\/g, "/"), readFileSync(full, "utf8")]);
  }
  return out;
}

const KEYS = ["LASTFM_API_KEY", "ACOUSTID_API_KEY", "ANTHROPIC_API_KEY", "CRON_SECRET", "FPCALC_PATH"];
/** Modules that read secrets or the database: a browser component must never import them. */
const SERVER_ONLY = ["@/lib/genre/server", "@/lib/genre/prismaStore", "@/lib/genre/prismaServices", "@/lib/genre/api", "@/lib/genre/statsServer", "@/lib/genre/llmReconciler", "@/lib/genre/fileTagReader", "@/lib/genre/fpcalc", "@/lib/curate/llmSpec", "@/lib/curate/llmRefine", "@/lib/curate/discover", "@/lib/prisma"];

describe("keys stay on the server", () => {
  const files = sourceFiles();
  const isClient = (text: string) => /^\s*["']use client["']/.test(text);

  it("no key or secret is exposed to the browser through a NEXT_PUBLIC_ variable", () => {
    const leaks = files.filter(([, text]) => KEYS.some((k) => new RegExp(`NEXT_PUBLIC_${k.replace("_API_KEY", "")}`).test(text) || text.includes(`NEXT_PUBLIC_${k}`))).map(([path]) => path);
    expect(leaks).toEqual([]);
  });

  it("a browser component never reads a key from the environment", () => {
    const reads = files.filter(([, text]) => isClient(text) && KEYS.some((k) => text.includes(`process.env.${k}`))).map(([path]) => path);
    expect(reads).toEqual([]);
  });

  it("a browser component never imports a module that reads a key or the database", () => {
    const bad = files
      .filter(([, text]) => isClient(text))
      .flatMap(([path, text]) => SERVER_ONLY.filter((m) => new RegExp(`from\\s+["']${m.replace(/[/@.]/g, "\\$&")}["']`).test(text)).map((m) => `${path} imports ${m}`));
    expect(bad).toEqual([]);
  });

  it("the secrets are read only in server-side files", () => {
    const readers = files.filter(([path, text]) => KEYS.some((k) => text.includes(`process.env.${k}`)) && !path.endsWith(".test.ts")).map(([path]) => path);
    for (const path of readers) expect(path, `${path} reads a secret`).toMatch(/\/(api\/|lib\/genre\/server\.ts|lib\/anthropicJson|lib\/ai-|lib\/chat|lib\/anthropic|lib\/catalog|lib\/mailer)/);
  });
});
