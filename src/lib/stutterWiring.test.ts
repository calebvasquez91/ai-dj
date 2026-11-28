import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STUTTER_NOTE_SETTINGS } from "./djMoveSettings";
import { STUTTER_NOTES } from "./stutter";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

// The picked stutter note only works if the deck hands it to both ways a stutter starts. The planner functions are tested in stutter.test.ts; these
// checks keep the two call sites in DualDeckStage from losing the argument without a test noticing.
describe("the stutter note reaches the deck's two stutter calls", () => {
  const deck = read("components/DualDeckStage.tsx");

  it("passes the saved Settings note to manualStutter (the button)", () => {
    expect(deck).toMatch(/manualStutter\(\{[^}]*note: stutterNoteFor\(moves\.settings\.stutterNote\)[^}]*\}\)/);
  });

  it("passes the saved Settings note to planStutter (the automatic stutters)", () => {
    expect(deck).toMatch(/planStutter\(\{[^}]*note: stutterNoteFor\(moves\.settings\.stutterNote\)[^}]*\}\)/);
  });

  it("offers Auto plus exactly the notes the stutter planner knows, from the one list", () => {
    expect(STUTTER_NOTE_SETTINGS).toEqual(["auto", ...STUTTER_NOTES]);
    expect(STUTTER_NOTES).toEqual(["1/4", "1/8", "1/16"]);
  });
});
