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
const outside = () => sourceFiles().filter(([path]) => !path.startsWith(QUE_DIR));

/** The files that write the app's own name, "Que DJ" (add a file here when the app's name first appears in it). */
const APP_NAME_FILES = new Set([
  "src/app/(app)/admin/feedback/page.tsx",
  "src/app/globals.css",
  "src/app/layout.tsx",
  "src/app/login/page.tsx",
  "src/app/manifest.ts",
  "src/app/privacy/page.tsx",
  "src/app/signup/page.tsx",
  "src/components/BackgroundAudio.tsx",
  "src/components/FeedbackDialog.tsx",
  "src/components/FeedbackInboxView.tsx",
  "src/components/NavRail.tsx",
  "src/components/Sidebar.tsx",
  "src/components/TopBar.tsx",
  "src/lib/feedback.test.ts",
  "src/lib/feedback.ts",
  "src/lib/mailer.test.ts",
  "src/lib/mailer.ts",
]);

describe("Que is switched off and kept in his own folder", () => {
  it("is disabled", () => {
    expect(QUE_ENABLED).toBe(false);
  });

  it("is named nowhere outside features/que, in the UI text, the AI prompts, the styles or the code", () => {
    // The app's own name, "Que DJ", is not him: it may be written only in the files where the app names itself (APP_NAME_FILES).
    // Anywhere else "Que DJ" counts as naming him, so a line like "Que DJ says" in new copy or a prompt is caught.
    const found = outside()
      .filter(([path, text]) => /\bQue\b/.test(APP_NAME_FILES.has(path.split(sep).join("/")) ? text.replace(/\bQue DJ\b/g, "") : text))
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
