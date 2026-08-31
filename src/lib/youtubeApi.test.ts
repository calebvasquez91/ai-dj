import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseIsoDuration, listPlaylistItemsWithDuration } from "./youtubeApi";

vi.mock("./googleAuth", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("test-token"),
}));

describe("parseIsoDuration", () => {
  it("parses hours, minutes, and seconds", () => {
    expect(parseIsoDuration("PT1H2M3S")).toBe(1 * 3600 + 2 * 60 + 3);
  });

  it("parses minutes and seconds only", () => {
    expect(parseIsoDuration("PT4M13S")).toBe(4 * 60 + 13);
  });

  it("parses seconds only", () => {
    expect(parseIsoDuration("PT45S")).toBe(45);
  });

  it("returns 0 for an unparseable string", () => {
    expect(parseIsoDuration("not-a-duration")).toBe(0);
  });
});

describe("listPlaylistItemsWithDuration", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/playlistItems")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                snippet: {
                  title: "Real Song",
                  videoOwnerChannelTitle: "Real Artist - Topic",
                  resourceId: { videoId: "abc123" },
                  thumbnails: { medium: { url: "https://i.ytimg.com/abc123/mqdefault.jpg" } },
                },
              },
              {
                snippet: {
                  title: "Deleted video",
                  videoOwnerChannelTitle: "Whatever",
                  resourceId: { videoId: "deleted1" },
                },
              },
              {
                snippet: {
                  title: "Private video",
                  videoOwnerChannelTitle: "Whatever",
                  resourceId: { videoId: "private1" },
                },
              },
            ],
          })
        ) as unknown as Response;
      }
      if (url.includes("/videos")) {
        return new Response(
          JSON.stringify({ items: [{ id: "abc123", contentDetails: { duration: "PT3M30S" } }] })
        ) as unknown as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("filters out deleted/private videos and resolves real durations", async () => {
    const items = await listPlaylistItemsWithDuration("PL123");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      videoId: "abc123",
      title: "Real Song",
      artist: "Real Artist", // " - Topic" suffix stripped
      durationSec: 210,
    });
  });
});
