"use client";

import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import type { StemJobState } from "@/lib/stemAutopilot";
import { describeStemStatus } from "@/lib/stemStatus";
import { VOICE_SILENCE_CUT_SEC, lastVoiceEndSec, voiceCutoffSec } from "@/lib/voiceMap";

const STATE_LABEL: Record<StemJobState, string> = {
  unknown: "not checked yet",
  none: "up next for stems",
  processing: "separating…",
  ready: "stems ready",
  failed: "failed",
};

const STATE_CLASS: Record<StemJobState, string> = {
  unknown: "text-muted",
  none: "text-muted",
  processing: "text-accent-purple",
  ready: "text-accent-teal",
  failed: "text-accent-pink",
};

/**
 * The Stems section of the DJ decks view: the audio engineer's picks among the upcoming tracks, and the switch that
 * lets the app separate them on its own, within a spending budget (on by default; the server enforces the cap).
 */
export function StemsPanel() {
  const stemAuto = useStore((s) => s.stemAuto);
  const setStemAuto = useStore((s) => s.setStemAuto);
  const status = useStore((s) => s.stemAutopilot);
  const voiceCut = useStore((s) => s.voiceCut);
  const setVoiceCut = useStore((s) => s.setVoiceCut);
  const currentTrack = useStore((s) => s.currentTrack);
  const voiceMap = useStore((s) => (s.currentTrack ? s.trackVoiceMaps[s.currentTrack.id] : undefined));

  let voiceLine: string | null = null;
  if (voiceCut.enabled && currentTrack) {
    if (currentTrack.source !== "local") voiceLine = "Voice detection works on uploaded tracks.";
    else if (voiceMap === undefined) voiceLine = "Listening for this track's voices…";
    else if (voiceMap === null) voiceLine = "No voice data for this track, so it plays through as usual.";
    else {
      const cutoff = voiceCutoffSec(voiceMap, currentTrack.durationSec);
      const lastEnd = lastVoiceEndSec(voiceMap);
      voiceLine =
        cutoff != null && lastEnd != null
          ? `Singing ends at ${formatTime(lastEnd)}; moving on at ${formatTime(cutoff)} (from ${
              voiceMap.source === "stem" ? "the vocal stem" : "time-stamped lyrics"
            }).`
          : "The voices run to the end of this track, so it plays through as usual.";
    }
  }

  const summary =
    status.spentUsd != null && status.budgetUsd != null
      ? `$${status.spentUsd.toFixed(2)} of $${status.budgetUsd.toFixed(2)} budget used`
      : null;

  const headline = describeStemStatus({
    enabled: stemAuto.enabled,
    state: status.state,
    message: status.message,
    counts: status.counts,
  });
  const TONE_CLASS = {
    off: "text-muted",
    ok: "text-accent-teal",
    busy: "text-accent-purple",
    warn: "text-accent-pink",
  } as const;

  return (
    <section aria-label="Stems" className="card p-3 flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-accent-purple">Stems</h3>

      <div data-testid="stem-status" role="status" aria-live="polite" className="flex flex-col gap-0.5">
        <p className={`text-xs font-medium ${TONE_CLASS[headline.tone]}`}>{headline.label}</p>
        {headline.detail && <p className="text-[10px] text-muted break-words">{headline.detail}</p>}
      </div>

      <label className="flex items-start gap-2 text-xs text-muted cursor-pointer">
        <input
          type="checkbox"
          checked={stemAuto.enabled}
          onChange={(e) => setStemAuto({ enabled: e.target.checked })}
          className="mt-0.5 accent-accent-purple"
        />
        <span>
          Separate stems automatically for the DJ&apos;s picks
          <span className="block text-[10px]">
            The audio engineer picks upcoming tracks that suit stems; the app separates them ahead of time, one at a
            time, within a spending budget. Costs a few cents per track.
          </span>
        </span>
      </label>

      {stemAuto.enabled && summary && <p className="text-[10px] text-muted">{summary}</p>}

      {status.picks.length > 0 ? (
        <ul className="flex flex-col gap-1 text-[11px]">
          {status.picks.map((pick) => (
            <li key={pick.trackId} className="flex items-baseline justify-between gap-2 min-w-0">
              <span className="truncate" title={pick.reasons.join(", ")}>
                {pick.title}
              </span>
              <span className={`shrink-0 ${STATE_CLASS[pick.state]}`}>{STATE_LABEL[pick.state]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[10px] text-muted">No upcoming track suits stems yet (tracks need to be analysed first).</p>
      )}

      <div className="mt-1 border-t border-border/10 pt-2 flex flex-col gap-1">
        <label className="flex items-start gap-2 text-xs text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={voiceCut.enabled}
            onChange={(e) => setVoiceCut({ enabled: e.target.checked })}
            className="mt-0.5 accent-accent-purple"
          />
          <span>
            Move on when the singing stops
            <span className="block text-[10px]">
              {VOICE_SILENCE_CUT_SEC}{" "}seconds after a song&apos;s last voice, the next track comes in. Uses the vocal stem
              when there is one, otherwise time-stamped lyrics; a track with neither plays through as usual.
            </span>
          </span>
        </label>
        {voiceLine && <p className="text-[10px] text-muted">{voiceLine}</p>}
      </div>
    </section>
  );
}
