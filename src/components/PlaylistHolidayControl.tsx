"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { CUSTOM_PLAYLIST_THEMES, HOLIDAY_IDS, HOLIDAY_THEMES, holidayCountdown, isCustomThemeId, isHolidayId, upcomingHoliday, type HolidayId } from "@/lib/holidayThemes";
import type { Playlist } from "@/types/music";

const DISMISSED_PREFIX = "ai-dj:holiday-suggestion:";

function setHoliday(playlistId: string, holiday: HolidayId | null) {
  useStore.setState((s) => ({ playlists: s.playlists.map((p) => (p.id === playlistId ? { ...p, holidayTheme: holiday ?? undefined } : p)) }));
}

function wasDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

/**
 * The playlist's holiday theme: a picker (none, or one of the ten holidays), and, when a holiday is within three weeks, a suggestion to use its
 * theme here (shown once per holiday and year; "Not now" is remembered). Not shown on a system playlist: Spooky Music keeps its own look.
 */
export function PlaylistHolidayControl({ playlist }: { playlist: Pick<Playlist, "id" | "holidayTheme"> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which suggestion was just put away (so the banner goes at once, before storage is read again).
  const [putAway, setPutAway] = useState<string | null>(null);
  // the person's own day (not the UTC one, which has moved on by the evening in the Americas)
  // worked out once when the control appears, which is on the client only
  const [upcoming] = useState(() => upcomingHoliday(Date.now(), undefined, new Date().getTimezoneOffset()));
  const suggestionKey = upcoming ? `${upcoming.id}:${upcoming.year}` : null;
  const showSuggestion = upcoming != null && !playlist.holidayTheme && suggestionKey !== putAway && !wasDismissed(suggestionKey!);

  async function choose(holiday: HolidayId | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/playlists/${playlist.id}/holiday`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holiday }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) return setError(body?.error ?? "The holiday theme could not be saved. Try again.");
      setHoliday(playlist.id, holiday);
    } catch {
      setError("The holiday theme could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // A playlist with a custom theme (GTA6) keeps it: it is not one of the holiday themes, so it is shown here and not offered for change.
  if (isCustomThemeId(playlist.holidayTheme)) {
    return (
      <p className="text-xs text-muted">
        Custom theme: <span className="text-foreground">{CUSTOM_PLAYLIST_THEMES[playlist.holidayTheme].label}</span>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
        Holiday theme
        <select
          value={playlist.holidayTheme ?? ""}
          disabled={busy}
          onChange={(e) => void choose(isHolidayId(e.target.value) ? e.target.value : null)}
          className="rounded-lg bg-surface-hover border border-border/10 px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">None</option>
          {HOLIDAY_IDS.map((id) => (
            <option key={id} value={id}>
              {HOLIDAY_THEMES[id].label}
            </option>
          ))}
        </select>
      </label>
      {showSuggestion && upcoming && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm" role="status">
          <span>
            {holidayCountdown(upcoming.id, upcoming.daysAway)} Use the {HOLIDAY_THEMES[upcoming.id].label} theme for this playlist?
          </span>
          <button type="button" className="btn-outline !text-xs" disabled={busy} onClick={() => void choose(upcoming.id)}>
            Use theme
          </button>
          <button
            type="button"
            className="btn-outline !text-xs"
            onClick={() => {
              try {
                window.localStorage.setItem(DISMISSED_PREFIX + suggestionKey, "1");
              } catch {
                // not remembered: it may show again next visit
              }
              setPutAway(suggestionKey);
            }}
          >
            Not now
          </button>
        </div>
      )}
      {error && (
        <p className="text-xs text-accent-pink" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
