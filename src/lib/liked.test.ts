import { describe, expect, it } from "vitest";
import { toggleId, useLiked } from "./liked";

describe("toggleId", () => {
  it("adds a new like at the front", () => {
    expect(toggleId(["a", "b"], "c")).toEqual(["c", "a", "b"]);
  });

  it("removes a like that is already there", () => {
    expect(toggleId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("does not change what it was given", () => {
    const ids = ["a"];
    toggleId(ids, "b");
    expect(ids).toEqual(["a"]);
  });
});

describe("the liked store", () => {
  it("toggles a song on and off", () => {
    useLiked.setState({ ids: [] });
    useLiked.getState().toggle("x");
    expect(useLiked.getState().ids).toEqual(["x"]);
    useLiked.getState().toggle("x");
    expect(useLiked.getState().ids).toEqual([]);
  });
});
