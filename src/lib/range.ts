// HTTP Range header parsing for the local-storage audio routes
// (/api/tracks/[id]/audio, /api/fx/[id]/audio). Shared so the two can't drift,
// and so the edge cases RFC 9110 §14 defines are handled in one place:
//   - no/garbled/multi-range header      -> serve the whole file (ignore it)
//   - a satisfiable single range         -> 206 with that slice
//   - first byte at/after EOF, or a zero-length suffix (`bytes=-0`)
//                                        -> 416 Range Not Satisfiable
// The old per-route parser treated an out-of-bounds start as "no range" and
// answered 200 with the full file, which makes a seeking <audio> element
// re-download everything instead of getting the 416 it expects.

export type RangeResult =
  | { kind: "none" }
  | { kind: "range"; start: number; end: number }
  | { kind: "unsatisfiable" };

export function parseRangeHeader(header: string | null | undefined, size: number): RangeResult {
  if (!header) return { kind: "none" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: "none" };
  const [, startStr, endStr] = match;
  if (!startStr && !endStr) return { kind: "none" };

  // An empty file has no satisfiable byte range.
  if (size <= 0) return { kind: "unsatisfiable" };

  if (!startStr) {
    // Suffix range: the last N bytes.
    const suffix = Number(endStr);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startStr);
  if (!Number.isSafeInteger(start)) return { kind: "unsatisfiable" };
  if (endStr) {
    const end = Number(endStr);
    if (!Number.isSafeInteger(end) || end < start) return { kind: "none" }; // invalid spec — ignore the header
    if (start >= size) return { kind: "unsatisfiable" };
    return { kind: "range", start, end: Math.min(end, size - 1) };
  }
  if (start >= size) return { kind: "unsatisfiable" };
  return { kind: "range", start, end: size - 1 };
}
