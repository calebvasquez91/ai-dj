import { describe, expect, it } from "vitest";
import { canManagePlaylist } from "./playlistAccess";

const env = { ADMIN_USER_IDS: "u-admin" };

describe("canManagePlaylist", () => {
  it("lets the owner change their own playlist", () => {
    expect(canManagePlaylist("u1", "u1", env)).toBe(true);
  });
  it("lets the admin change anybody's playlist", () => {
    expect(canManagePlaylist("u1", "u-admin", env)).toBe(true);
  });
  it("keeps everybody else out of other accounts' playlists", () => {
    expect(canManagePlaylist("u1", "u2", env)).toBe(false);
    expect(canManagePlaylist("u1", "u2", {})).toBe(false);
  });
});
