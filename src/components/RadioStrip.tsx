"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { SEED_RADIO_ENABLED } from "@/lib/featureFlags";
import { savePlaylistFromTracks } from "@/lib/savePlaylist";

/**
 * Shown at the top of the queue while a seed radio is running (and only when SEED_RADIO_ENABLED is on): which song it grew from, a "Save as
 * playlist" button that keeps what is playing and queued as a normal playlist, and, when too few songs in the library go with the seed, a plain
 * note with artists worth looking for (names only: nothing here adds or fetches audio) instead of a queue padded with weak matches.
 */
export function RadioStrip() {
  const router = useRouter();
  const session = useStore((s) => s.radioSession);
  const notice = useStore((s) => s.radioNotice);
  const currentTrack = useStore((s) => s.currentTrack);
  const library = useStore((s) => s.localLibrary);
  const [saving, setSaving] = useState(false);
  if (!SEED_RADIO_ENABLED || !session) return null;
  const seed = library.find((t) => t.id === session.seedId);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface px-3 py-2" aria-label="Radio">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs font-semibold text-accent-purple truncate">
          Radio{seed ? ` · based on “${seed.title}”` : ""}
        </p>
        <button
          type="button"
          className="btn-outline !text-xs shrink-0"
          disabled={saving}
          title="Save what is playing and queued as a playlist you can edit"
          onClick={async () => {
            setSaving(true);
            try {
              const { currentTrack: playing, queue } = useStore.getState();
              const ids = [...(playing ? [playing.id] : []), ...queue.map((t) => t.id)];
              const id = await savePlaylistFromTracks(seed ? `${seed.artist} radio` : "Radio", ids);
              if (id) router.push(`/playlist?id=${id}`);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save as playlist"}
        </button>
      </div>
      {notice && currentTrack && (
        <div className="text-xs text-muted" role="status">
          <p>Not many songs in your library go with this one, so the radio is short instead of filling up with songs that don&apos;t fit.</p>
          {notice.discover.length > 0 && <p className="mt-1">Artists worth looking for: {notice.discover.join(", ")}.</p>}
        </div>
      )}
    </div>
  );
}
