import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { listMyPlaylists, listPlaylistTracks } from "./spotifyApi";

vi.mock("./spotifyAuth", () => ({
  getValidSpotifyToken: vi.fn().mockResolvedValue("test-token"),
}));

describe("listMyPlaylists", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/me")) {
        return new Response(JSON.stringify({ id: "my-user-id" })) as unknown as Response;
      }
      if (url.includes("offset=50")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "pl2",
                name: "Chill",
                images: [],
                items: { total: 3 },
                owner: { id: "my-user-id" },
                collaborative: false,
              },
              {
                id: "pl3",
                name: "Followed Mix",
                images: [],
                items: { total: 50 },
                owner: { id: "someone-else" },
                collaborative: false,
              },
            ],
            next: null,
          })
        ) as unknown as Response;
      }
      if (url.includes("/me/playlists")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "pl1",
                name: "Road Trip",
                images: [{ url: "https://i.scdn.co/pl1.jpg" }],
                items: { total: 12 },
                owner: { id: "someone-else" },
                collaborative: true,
              },
            ],
            next: "https://api.spotify.com/v1/me/playlists?offset=50&limit=50",
          })
        ) as unknown as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("follows pagination via the next URL and maps every page", async () => {
    const playlists = await listMyPlaylists();
    expect(playlists).toEqual([
      { id: "pl1", title: "Road Trip", thumbnailUrl: "https://i.scdn.co/pl1.jpg", itemCount: 12, accessible: true },
      { id: "pl2", title: "Chill", thumbnailUrl: undefined, itemCount: 3, accessible: true },
      { id: "pl3", title: "Followed Mix", thumbnailUrl: undefined, itemCount: 50, accessible: false },
    ]);
    // pl1: owned by someone else but collaborative -> accessible. pl2: owned by the
    // connected account -> accessible. pl3: neither -> not accessible.
  });
});

describe("listPlaylistTracks", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          items: [
            {
              item: {
                id: "t1",
                name: "Real Song",
                artists: [{ name: "Real Artist" }],
                album: { images: [{ url: "https://i.scdn.co/t1.jpg" }] },
                duration_ms: 210000,
                is_local: false,
              },
            },
            { item: null }, // removed/unavailable item
            {
              item: {
                id: null,
                name: "Uploaded MP3",
                artists: [{ name: "Someone" }],
                album: { images: [] },
                duration_ms: 180000,
                is_local: true, // locally-uploaded file inside the playlist — no streamable URI
              },
            },
          ],
          next: null,
        })
      ) as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("filters out null and is_local tracks, keeping only streamable ones", async () => {
    const tracks = await listPlaylistTracks("pl1");
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      spotifyTrackId: "t1",
      title: "Real Song",
      artist: "Real Artist",
      durationSec: 210,
    });
  });
});
