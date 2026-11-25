import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isMissingTableError, songListLoaderFor } from "./songListAccess";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");
const loader = async () => [];

describe("who is sent the owner's song list", () => {
  const env = { ADMIN_USER_IDS: "owner-1, owner-2" };

  it("the admin gets the loader", () => {
    expect(songListLoaderFor("owner-1", loader, env)).toBe(loader);
    expect(songListLoaderFor("owner-2", loader, env)).toBe(loader);
    expect(songListLoaderFor("admin-1", loader, { FEEDBACK_ADMIN_USER_IDS: "admin-1" })).toBe(loader);
  });

  it("everyone else gets nothing: another account, no account, a near miss, or no admin configured at all", () => {
    expect(songListLoaderFor("someone-else", loader, env)).toBeUndefined();
    expect(songListLoaderFor(null, loader, env)).toBeUndefined();
    expect(songListLoaderFor(undefined, loader, env)).toBeUndefined();
    expect(songListLoaderFor("OWNER-1", loader, env)).toBeUndefined();
    expect(songListLoaderFor("owner", loader, env)).toBeUndefined();
    expect(songListLoaderFor("owner-1", loader, {})).toBeUndefined();
  });

  it("the curate route hands the list over only through that gate, never directly", () => {
    const route = read("app/api/ai/curate/route.ts");
    expect(route).toContain("loadSongList: songListLoaderFor(userId, loadSongListRows)");
    expect(route).not.toMatch(/loadSongList:\s*loadSongListRows/);
    expect(route.match(/loadSongListRows/g)?.length).toBe(2); // the import and the one gated use
  });
});

describe("which database errors mean 'the table is not there yet'", () => {
  it("recognises a missing table however the driver reports it", () => {
    expect(isMissingTableError({ code: "P2021" })).toBe(true);
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ meta: { driverAdapterError: { cause: { originalCode: "42P01" } } } })).toBe(true);
    expect(isMissingTableError({ meta: { driverAdapterError: { cause: { kind: "TableDoesNotExist" } } } })).toBe(true);
    expect(isMissingTableError(new Error('relation "SongListEntry" does not exist'))).toBe(true);
    expect(isMissingTableError(new Error("The table `public.SongListEntry` does not exist in the current database."))).toBe(true);
  });

  it("does not hide anything else: a lost connection, a missing column, a timeout, a non-error", () => {
    expect(isMissingTableError(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe(false);
    expect(isMissingTableError(new Error('column "genre" does not exist'))).toBe(false);
    expect(isMissingTableError({ code: "P1001" })).toBe(false);
    expect(isMissingTableError(new Error("timeout"))).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError("relation does not exist")).toBe(false);
  });
});
