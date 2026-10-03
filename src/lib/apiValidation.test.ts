import { describe, expect, it } from "vitest";
import {
  MAX_DURATION_SEC,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  MAX_TEXT_LENGTH,
  MAX_WAVEFORM_PEAKS,
  cleanTags,
  cleanText,
  cleanWaveformPeaks,
  isAcceptableStorageUrl,
  isValidDuration,
  isYouTubeThumbnailUrl,
  isYouTubeVideoId,
  normalizeAudioMime,
  normalizeEmail,
  parseAffinityField,
} from "@/lib/apiValidation";

describe("normalizeAudioMime", () => {
  it("keeps real audio types, lowercased", () => {
    expect(normalizeAudioMime("audio/wav")).toBe("audio/wav");
    expect(normalizeAudioMime(" Audio/FLAC ")).toBe("audio/flac");
    expect(normalizeAudioMime("audio/x-m4a")).toBe("audio/x-m4a");
  });
  it("falls back to audio/mpeg for anything else (never echoes text/html)", () => {
    expect(normalizeAudioMime("text/html")).toBe("audio/mpeg");
    expect(normalizeAudioMime("audio/mpeg; charset=utf-8")).toBe("audio/mpeg");
    expect(normalizeAudioMime("")).toBe("audio/mpeg");
    expect(normalizeAudioMime(undefined)).toBe("audio/mpeg");
    expect(normalizeAudioMime("audio/<script>")).toBe("audio/mpeg");
  });
});

describe("cleanText", () => {
  it("trims and bounds length", () => {
    expect(cleanText("  hi  ")).toBe("hi");
    expect(cleanText("x".repeat(MAX_TEXT_LENGTH + 50))).toHaveLength(MAX_TEXT_LENGTH);
    expect(cleanText("abcdef", 3)).toBe("abc");
  });
  it("returns empty for non-strings", () => {
    expect(cleanText(undefined)).toBe("");
    expect(cleanText(5)).toBe("");
    expect(cleanText(null)).toBe("");
    expect(cleanText({})).toBe("");
  });
});

describe("isValidDuration", () => {
  it("accepts sane durations", () => {
    expect(isValidDuration(0)).toBe(true);
    expect(isValidDuration(215.4)).toBe(true);
    expect(isValidDuration(MAX_DURATION_SEC)).toBe(true);
  });
  it("rejects negative, huge, NaN, Infinity and non-numbers", () => {
    expect(isValidDuration(-1)).toBe(false);
    expect(isValidDuration(MAX_DURATION_SEC + 1)).toBe(false);
    expect(isValidDuration(NaN)).toBe(false);
    expect(isValidDuration(Infinity)).toBe(false);
    expect(isValidDuration("100")).toBe(false);
    expect(isValidDuration(null)).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Foo@Example.COM ")).toBe("foo@example.com");
  });
  it("returns empty for non-strings", () => {
    expect(normalizeEmail(undefined)).toBe("");
    expect(normalizeEmail(42)).toBe("");
  });
});

describe("cleanTags", () => {
  it("trims, drops empties and non-strings, de-duplicates case-insensitively", () => {
    expect(cleanTags([" Halloween ", "", "spooky", "SPOOKY", 5, null, "  "])).toEqual(["Halloween", "spooky"]);
  });
  it("bounds count and per-tag length", () => {
    const many = Array.from({ length: MAX_TAGS + 20 }, (_, i) => `tag${i}`);
    expect(cleanTags(many)).toHaveLength(MAX_TAGS);
    expect(cleanTags(["a".repeat(MAX_TAG_LENGTH + 10)])[0]).toHaveLength(MAX_TAG_LENGTH);
  });
  it("returns [] for non-arrays", () => {
    expect(cleanTags("nope")).toEqual([]);
    expect(cleanTags(undefined)).toEqual([]);
  });
});

describe("isAcceptableStorageUrl", () => {
  const blob = "https://abc123.public.blob.vercel-storage.com/track-xyz.mp3";
  it("accepts a Vercel Blob URL on the blob backend", () => {
    expect(isAcceptableStorageUrl(blob, "blob")).toBe(true);
  });
  it("rejects non-blob hosts on the blob backend", () => {
    expect(isAcceptableStorageUrl("https://evil.example.com/a.mp3", "blob")).toBe(false);
    expect(isAcceptableStorageUrl("https://blob.vercel-storage.com.evil.com/a.mp3", "blob")).toBe(false);
  });
  it("requires https on every backend", () => {
    expect(isAcceptableStorageUrl("http://abc.public.blob.vercel-storage.com/a.mp3", "blob")).toBe(false);
    expect(isAcceptableStorageUrl("javascript:alert(1)", "local")).toBe(false);
    expect(isAcceptableStorageUrl("file:///etc/passwd", "local")).toBe(false);
  });
  it("is lenient about host on the local dev backend", () => {
    expect(isAcceptableStorageUrl("https://example.invalid/a.mp3", "local")).toBe(true);
  });
  it("rejects junk", () => {
    expect(isAcceptableStorageUrl("not a url", "local")).toBe(false);
    expect(isAcceptableStorageUrl(undefined, "local")).toBe(false);
    expect(isAcceptableStorageUrl("https://a.com/" + "x".repeat(3000), "local")).toBe(false);
  });
});

describe("isYouTubeThumbnailUrl", () => {
  it("accepts only i.ytimg.com over https", () => {
    expect(isYouTubeThumbnailUrl("https://i.ytimg.com/vi/abc/hqdefault.jpg")).toBe(true);
    expect(isYouTubeThumbnailUrl("http://i.ytimg.com/vi/abc/hqdefault.jpg")).toBe(false);
    expect(isYouTubeThumbnailUrl("https://evil.com/i.ytimg.com.jpg")).toBe(false);
    expect(isYouTubeThumbnailUrl("https://i.ytimg.com.evil.com/x.jpg")).toBe(false);
    expect(isYouTubeThumbnailUrl("")).toBe(false);
    expect(isYouTubeThumbnailUrl(undefined)).toBe(false);
  });
});

describe("isYouTubeVideoId", () => {
  it("accepts typical ids and rejects odd ones", () => {
    expect(isYouTubeVideoId("dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeVideoId("a-b_c1234")).toBe(true);
    expect(isYouTubeVideoId("")).toBe(false);
    expect(isYouTubeVideoId("short")).toBe(false);
    expect(isYouTubeVideoId("has space 1234")).toBe(false);
    expect(isYouTubeVideoId("x".repeat(40))).toBe(false);
    expect(isYouTubeVideoId(12345678901)).toBe(false);
  });
});

describe("cleanWaveformPeaks", () => {
  it("returns the array when valid", () => {
    expect(cleanWaveformPeaks([0, 0.5, 1])).toEqual([0, 0.5, 1]);
  });
  it("rejects non-arrays, non-finite entries and oversize arrays", () => {
    expect(cleanWaveformPeaks("x")).toBeNull();
    expect(cleanWaveformPeaks([0, "a"])).toBeNull();
    expect(cleanWaveformPeaks([0, NaN])).toBeNull();
    expect(cleanWaveformPeaks(new Array(MAX_WAVEFORM_PEAKS + 1).fill(0))).toBeNull();
  });
});

describe("parseAffinityField", () => {
  it("accepts an array", () => {
    expect(parseAffinityField(["spooky", "halloween"])).toEqual(["spooky", "halloween"]);
  });

  it("accepts a JSON-encoded array (multipart form field)", () => {
    expect(parseAffinityField('["spooky","halloween"]')).toEqual(["spooky", "halloween"]);
  });

  it("dedupes and drops junk", () => {
    expect(parseAffinityField(["spooky", "Spooky", 5, "", null])).toEqual(["spooky"]);
  });

  it("returns [] for missing, malformed or non-array input", () => {
    expect(parseAffinityField(null)).toEqual([]);
    expect(parseAffinityField(undefined)).toEqual([]);
    expect(parseAffinityField("not json")).toEqual([]);
    expect(parseAffinityField('{"a":1}')).toEqual([]);
    expect(parseAffinityField(42)).toEqual([]);
  });
});
