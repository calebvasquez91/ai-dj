import { describe, expect, it } from "vitest";
import {
  addRecentSearch,
  cleanRecentSearch,
  loadRecentSearches,
  RECENT_SEARCH_KEY,
  RECENT_SEARCH_LIMIT,
  removeRecentSearch,
  saveRecentSearches,
} from "./recentSearches";

function memoryStorage(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[RECENT_SEARCH_KEY, initial]]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe("cleanRecentSearch", () => {
  it("trims and collapses spaces, and drops anything too short", () => {
    expect(cleanRecentSearch("  daft   punk ")).toBe("daft punk");
    expect(cleanRecentSearch("a")).toBeNull();
    expect(cleanRecentSearch("   ")).toBeNull();
  });
});

describe("addRecentSearch", () => {
  it("puts the newest first and moves a repeat (in any case) to the front", () => {
    expect(addRecentSearch(["bb", "aa"], "cc")).toEqual(["cc", "bb", "aa"]);
    expect(addRecentSearch(["trap", "slow jams"], "Trap")).toEqual(["Trap", "slow jams"]);
  });
  it("keeps only the most recent few", () => {
    let list: string[] = [];
    for (let i = 0; i < RECENT_SEARCH_LIMIT + 4; i++) list = addRecentSearch(list, `query ${i}`);
    expect(list).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(list[0]).toBe(`query ${RECENT_SEARCH_LIMIT + 3}`);
  });
  it("leaves the list alone for a query not worth keeping", () => {
    expect(addRecentSearch(["trap"], " ")).toEqual(["trap"]);
  });
});

describe("removeRecentSearch", () => {
  it("removes one search, whatever its case", () => {
    expect(removeRecentSearch(["Trap", "rock"], "trap")).toEqual(["rock"]);
  });
});

describe("loadRecentSearches / saveRecentSearches", () => {
  it("round-trips through storage", () => {
    const storage = memoryStorage();
    saveRecentSearches(storage, ["trap", "90s r&b"]);
    expect(loadRecentSearches(storage)).toEqual(["trap", "90s r&b"]);
  });
  it("reads nothing usable as an empty list: missing, corrupt, the wrong shape, or no storage", () => {
    expect(loadRecentSearches(memoryStorage())).toEqual([]);
    expect(loadRecentSearches(memoryStorage("not json"))).toEqual([]);
    expect(loadRecentSearches(memoryStorage('{"a":1}'))).toEqual([]);
    expect(loadRecentSearches(null)).toEqual([]);
  });
  it("drops entries that are not text, and survives storage that throws", () => {
    expect(loadRecentSearches(memoryStorage('["ok", 5, null, "x", "fine"]'))).toEqual(["ok", "fine"]);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(loadRecentSearches(broken)).toEqual([]);
    expect(() => saveRecentSearches(broken, ["a b"])).not.toThrow();
  });
});
