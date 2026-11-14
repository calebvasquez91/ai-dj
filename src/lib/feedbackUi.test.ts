import { beforeEach, describe, expect, it } from "vitest";
import { useFeedbackUi } from "@/lib/feedbackUi";

const button = { id: "avatar" } as unknown as HTMLElement;
const other = { id: "other" } as unknown as HTMLElement;

beforeEach(() => useFeedbackUi.getState().closeFeedback());

describe("useFeedbackUi", () => {
  it("starts closed with nowhere to return focus to", () => {
    expect(useFeedbackUi.getState()).toMatchObject({ open: false, source: null, returnFocusTo: null });
  });

  it("opens with its source, and with no return target unless one is given", () => {
    useFeedbackUi.getState().openFeedback("prompt");
    expect(useFeedbackUi.getState()).toMatchObject({ open: true, source: "prompt", returnFocusTo: null });
  });

  it("remembers the control focus should go back to (the phone account menu's button)", () => {
    useFeedbackUi.getState().openFeedback("menu", button);
    expect(useFeedbackUi.getState()).toMatchObject({ open: true, source: "menu", returnFocusTo: button });
  });

  it("ignores a second open while it is already open, keeping the first source and target", () => {
    useFeedbackUi.getState().openFeedback("prompt");
    useFeedbackUi.getState().openFeedback("menu", other);
    expect(useFeedbackUi.getState()).toMatchObject({ source: "prompt", returnFocusTo: null });
    useFeedbackUi.getState().closeFeedback();
    useFeedbackUi.getState().openFeedback("menu", button);
    useFeedbackUi.getState().openFeedback("prompt", other);
    expect(useFeedbackUi.getState()).toMatchObject({ source: "menu", returnFocusTo: button });
  });

  it("forgets the target when it closes, so the next open can't return focus to a stale element", () => {
    useFeedbackUi.getState().openFeedback("menu", button);
    useFeedbackUi.getState().closeFeedback();
    expect(useFeedbackUi.getState()).toMatchObject({ open: false, source: null, returnFocusTo: null });
    useFeedbackUi.getState().openFeedback("menu");
    expect(useFeedbackUi.getState().returnFocusTo).toBeNull();
  });
});
