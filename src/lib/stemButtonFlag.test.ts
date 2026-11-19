import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHOW_STEM_BUTTON_ON_SONGS } from "./featureFlags";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf-8");

describe("the per-song stem button", () => {
  it("is off, so no song shows a stem button or a separating chip", () => {
    expect(SHOW_STEM_BUTTON_ON_SONGS).toBe(false);
  });

  it("is only ever rendered behind that flag (library rows and cards are the only places it was)", () => {
    for (const file of ["components/TrackList.tsx", "components/TrackGrid.tsx"]) {
      const source = read(file);
      expect(source, file).toMatch(/SHOW_STEM_BUTTON_ON_SONGS && <SeparateStemsButton /);
      // every use of the component is the gated one
      expect(source.match(/<SeparateStemsButton/g)?.length, file).toBe(1);
    }
  });

  it("leaves the stem engine's own switch alone: it is a separate flag", () => {
    const flags = read("lib/featureFlags.ts");
    expect(flags).toMatch(/export const STEM_FEATURES_ENABLED = process\.env\.NEXT_PUBLIC_STEM_FEATURES === "on"/);
  });
});
