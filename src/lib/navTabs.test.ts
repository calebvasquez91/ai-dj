import { describe, expect, it } from "vitest";
import { NAV_TABS, activeTabHref } from "./navTabs";

describe("NAV_TABS", () => {
  it("is Home, Music Library, Playlists, Search, in that order", () => {
    expect(NAV_TABS.map((t) => t.label)).toEqual(["Home", "Music Library", "Playlists", "Search"]);
    expect(NAV_TABS.map((t) => t.href)).toEqual(["/", "/library", "/playlists", "/search"]);
  });
});

describe("activeTabHref", () => {
  it("lights the tab for its own page", () => {
    expect(activeTabHref("/")).toBe("/");
    expect(activeTabHref("/library")).toBe("/library");
    expect(activeTabHref("/playlists")).toBe("/playlists");
    expect(activeTabHref("/search")).toBe("/search");
  });

  it("keeps Playlists lit while one playlist is open", () => {
    expect(activeTabHref("/playlist")).toBe("/playlists");
  });

  it("ignores a trailing slash", () => {
    expect(activeTabHref("/library/")).toBe("/library");
  });

  it("lights nothing for a page no tab owns", () => {
    expect(activeTabHref("/inspiration")).toBeNull();
    expect(activeTabHref("/libraryx")).toBeNull();
  });
});
