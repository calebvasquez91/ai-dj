// Pure planning for PATCH /api/playlists/[id]/tracks/reorder.
//
// The old route rewrote EVERY row's position with one UPDATE per track and
// never checked the submitted ids against the playlist: a stale client (a
// track added or removed in another tab) silently produced a half-updated
// order with colliding positions. This validates the submitted order is
// exactly the playlist's current membership (else the caller returns 409 and
// the client re-syncs) and emits writes only for rows that actually move — a
// single adjacent swap is 2 updates instead of N.

export interface PlaylistRow {
  trackId: string;
  position: number;
}

export type ReorderPlan =
  | { ok: true; updates: { trackId: string; position: number }[] }
  | { ok: false; reason: "duplicate-ids" | "membership-mismatch" };

export function planReorder(current: readonly PlaylistRow[], requestedTrackIds: readonly string[]): ReorderPlan {
  if (new Set(requestedTrackIds).size !== requestedTrackIds.length) return { ok: false, reason: "duplicate-ids" };

  // Ids with no PlaylistTrack row are ignored, not rejected: the Spooky Music
  // system playlist shows tag-matched tracks that have no row (see
  // loadUserPlaylistsWithSpookyUnion), and the client sends its full visible
  // order. What must hold is that every real row is accounted for.
  const positionById = new Map(current.map((r) => [r.trackId, r.position]));
  const ordered = requestedTrackIds.filter((id) => positionById.has(id));
  if (ordered.length !== current.length) return { ok: false, reason: "membership-mismatch" };

  const updates: { trackId: string; position: number }[] = [];
  ordered.forEach((trackId, position) => {
    if (positionById.get(trackId) !== position) updates.push({ trackId, position });
  });
  return { ok: true, updates };
}
