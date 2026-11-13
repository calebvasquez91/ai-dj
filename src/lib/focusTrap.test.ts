import { describe, expect, it } from "vitest";
import { cycleFocus } from "@/lib/focusTrap";

const items = ["close", "star", "comment", "later", "send"];

describe("cycleFocus", () => {
  it("wraps forward from the last item to the first, and backward from the first to the last", () => {
    expect(cycleFocus(items, "send", false)).toBe("close");
    expect(cycleFocus(items, "close", true)).toBe("send");
  });

  it("leaves the browser's own Tab order alone in the middle of the list", () => {
    expect(cycleFocus(items, "star", false)).toBeNull();
    expect(cycleFocus(items, "comment", true)).toBeNull();
    expect(cycleFocus(items, "close", false)).toBeNull();
    expect(cycleFocus(items, "send", true)).toBeNull();
  });

  it("brings focus that is outside the list (on the dialog itself, or behind it) back in", () => {
    expect(cycleFocus(items, "dialog", false)).toBe("close");
    expect(cycleFocus(items, "dialog", true)).toBe("send");
    expect(cycleFocus(items, null, false)).toBe("close");
  });

  it("handles a single item and an empty dialog", () => {
    expect(cycleFocus(["only"], "only", false)).toBe("only");
    expect(cycleFocus(["only"], "only", true)).toBe("only");
    expect(cycleFocus([], "x", false)).toBeNull();
  });
});
