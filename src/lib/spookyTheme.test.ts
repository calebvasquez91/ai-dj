import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Spooky Music's look is not part of the holiday themes and must not change by accident. This pins every CSS rule in globals.css that is about
// Spooky (the waveform colours and flicker, the background lights, the Now Playing re-pointed tokens, the black page tokens, the sparkles, the
// card pulse), the Spooky waveform classes in the deck view, and the colours themselves. If one of these fails you have changed Spooky Music;
// if that is on purpose, review the diff of the snapshot file and update it deliberately (`vitest -u`).

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

/** Every top-level CSS rule (and @keyframes / @media block) in the stylesheet whose selector or name mentions "spooky", with its whole body, whitespace squeezed. */
function spookyRules(css: string): string[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < noComments.length; i++) {
    const c = noComments[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const rule = noComments.slice(start, i + 1).trim();
        if (/spooky/i.test(rule)) rules.push(rule.replace(/\s+/g, " "));
        start = i + 1;
      }
    } else if (c === ";" && depth === 0) start = i + 1; // a top-level statement such as @import
  }
  return rules;
}

describe("Spooky Music theme", () => {
  const css = read("app/globals.css");

  it("keeps every Spooky rule in globals.css exactly as it is", async () => {
    await expect(spookyRules(css).join("\n") + "\n").toMatchFileSnapshot("./__snapshots__/spooky-theme.css");
  });

  it("keeps its signature colours: the waveform cycle, the background lights and the black page", () => {
    const rules = spookyRules(css).join("\n");
    for (const colour of ["#ff6b00", "#8b00ff", "#00ff41", "#ff1a1a", "#2a0a2a", "#fff1e0", "#d4bfe6", "#2a1236", "#3a1a48", "#6b3a73", "#0c0813", "#181022", "#cdb8e0", "#3a2150"]) {
      expect(rules, colour).toContain(colour);
    }
    expect(rules).toMatch(/:root\[data-spooky="true"\]/);
    expect(rules).toMatch(/\.spooky-bar-played/);
    expect(rules).toMatch(/--shadow-boost: 1\.8/);
  });

  it("keeps the Spooky waveform classes on the deck's waveform bars", () => {
    const deck = read("components/DeckView.tsx");
    expect(deck).toMatch(/spooky\s*\?\s*"spooky-bar-played"/);
    expect(deck).toMatch(/spooky\s*\?\s*"spooky-bar-unplayed"/);
  });

  it("keeps the colours, class names and animation names the Halloween components use", async () => {
    // Not a hash of the files (any harmless edit would break that): the colours, rgba values, spooky-/music-wave class names and keyframe names they
    // contain, which is what makes the look. Add to the components freely; changing one of these is changing Spooky Music.
    const tokens = (p: string) => [...new Set(read(p).match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|(?:spooky|halloween|music-wave)[\w-]*/g) ?? [])].sort();
    const report = ["HalloweenLayers.tsx", "SpookyBackdrop.tsx"].map((f) => [f, ...tokens(`components/${f}`)].join("\n")).join("\n\n") + "\n";
    await expect(report).toMatchFileSnapshot("./__snapshots__/spooky-components.txt");
  });

  it("finds a real set of Spooky rules to pin (the parser is not matching nothing)", () => {
    expect(spookyRules(css).length).toBeGreaterThan(15);
  });
});
