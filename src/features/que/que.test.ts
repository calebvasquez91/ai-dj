import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { QUE_ENABLED } from "./flag";

/** Every source file under src (not generated code), as [path, text]. */
function sourceFiles(dir = "src"): [string, string][] {
  const out: [string, string][] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (full.includes(`${sep}generated`)) continue;
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|css)$/.test(name)) out.push([full, readFileSync(full, "utf8")]);
  }
  return out;
}

const QUE_DIR = `src${sep}features${sep}que${sep}`;
// The tree is read once for the whole file: each test below used to read every source file again, and on a slow disk
// (a OneDrive folder, a busy machine) four full scans ran past the 5 s test timeout.
let scanned: [string, string][] | undefined;
const outside = () => (scanned ??= sourceFiles()).filter(([path]) => !path.startsWith(QUE_DIR));

describe("Que is switched off and kept in his own folder", { timeout: 30_000 }, () => {
  it("is disabled", () => {
    expect(QUE_ENABLED).toBe(false);
  });

  it("is named nowhere outside features/que, in the UI text, the AI prompts, the styles or the code", () => {
    const found = outside()
      .filter(([, text]) => /\bQue\b/.test(text))
      .map(([path]) => path);
    expect(found).toEqual([]);
  });

  it("is only imported from outside through the folder's index, never a file inside it", () => {
    const deep = outside()
      .filter(([, text]) => /from\s+["']@\/features\/que\/\w/.test(text))
      .map(([path]) => path);
    expect(deep).toEqual([]);
  });

  it("is only used outside behind the flag: every file that imports him also checks QUE_ENABLED", () => {
    const unguarded = outside()
      .filter(([, text]) => /from\s+["']@\/features\/que["']/.test(text) && !/\bQUE_ENABLED\b/.test(text.replace(/import[^;]*from\s+["']@\/features\/que["'];?/, "")))
      .map(([path]) => path);
    expect(unguarded).toEqual([]);
  });

  it("leaves no old component files behind", () => {
    const old = sourceFiles("src/components").filter(([path]) => /[\\/]Que(Costumes|Dock)?\.tsx$/.test(path));
    expect(old).toEqual([]);
  });
});
