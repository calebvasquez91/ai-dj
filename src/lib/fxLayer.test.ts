import { describe, expect, it } from "vitest";
import { FX_LOAD_IDLE, beginFxRequest, finishFxRequest, pressFx, resetFxLoad } from "./fxLayer";

describe("pressFx", () => {
  it("starts a sound when nothing is playing or loading", () => {
    expect(pressFx(FX_LOAD_IDLE, false)).toEqual({ action: "start", state: FX_LOAD_IDLE });
  });

  it("stops the sound when one is playing", () => {
    expect(pressFx(FX_LOAD_IDLE, true).action).toBe("stop");
  });

  it("stops (cancels) when a sound is still loading", () => {
    const { state } = beginFxRequest(FX_LOAD_IDLE);
    const press = pressFx(state, false);
    expect(press.action).toBe("stop");
    expect(press.state.loading).toBe(false);
  });
});

describe("a request's life", () => {
  it("starts the sound when its decode finishes with nothing playing", () => {
    const begun = beginFxRequest(FX_LOAD_IDLE);
    expect(begun.state.loading).toBe(true);
    const done = finishFxRequest(begun.state, begun.token, true, false);
    expect(done.outcome).toBe("start");
    expect(done.state.loading).toBe(false);
  });

  it("replaces the playing sound when another is playing at that moment", () => {
    const begun = beginFxRequest(FX_LOAD_IDLE);
    expect(finishFxRequest(begun.state, begun.token, true, true).outcome).toBe("replace");
  });

  it("reports a failed decode for the live request and stops showing it as loading", () => {
    const begun = beginFxRequest(FX_LOAD_IDLE);
    const done = finishFxRequest(begun.state, begun.token, false, false);
    expect(done.outcome).toBe("failed");
    expect(done.state.loading).toBe(false);
  });
});

describe("cancelling and superseding", () => {
  it("a stop press while loading makes the request stand down when it finishes", () => {
    const begun = beginFxRequest(FX_LOAD_IDLE);
    const pressed = pressFx(begun.state, false);
    const done = finishFxRequest(pressed.state, begun.token, true, false);
    expect(done.outcome).toBe("cancelled");
    expect(done.state).toEqual(pressed.state); // and it leaves the state alone
  });

  it("a newer request supersedes an older one still decoding; only the newest starts", () => {
    const a = beginFxRequest(FX_LOAD_IDLE);
    const b = beginFxRequest(a.state);
    // A finishes first: stale, stands down — and must not clear B's loading flag
    const aDone = finishFxRequest(b.state, a.token, true, false);
    expect(aDone.outcome).toBe("cancelled");
    expect(aDone.state.loading).toBe(true);
    const bDone = finishFxRequest(aDone.state, b.token, true, false);
    expect(bDone.outcome).toBe("start");
  });

  it("an older request's failure is ignored once a newer one is live", () => {
    const a = beginFxRequest(FX_LOAD_IDLE);
    const b = beginFxRequest(a.state);
    const aFailed = finishFxRequest(b.state, a.token, false, false);
    expect(aFailed.outcome).toBe("cancelled");
    expect(aFailed.state.loading).toBe(true);
  });

  it("teardown cancels whatever is in flight", () => {
    const begun = beginFxRequest(FX_LOAD_IDLE);
    const reset = resetFxLoad(begun.state);
    expect(reset.loading).toBe(false);
    expect(finishFxRequest(reset, begun.token, true, false).outcome).toBe("cancelled");
  });

  it("can't get stuck: after any outcome a fresh press starts again", () => {
    let s = beginFxRequest(FX_LOAD_IDLE).state;
    s = pressFx(s, false).state; // cancelled while loading
    expect(pressFx(s, false).action).toBe("start");
    const begun = beginFxRequest(s);
    const failed = finishFxRequest(begun.state, begun.token, false, false);
    expect(pressFx(failed.state, false).action).toBe("start");
  });
});
