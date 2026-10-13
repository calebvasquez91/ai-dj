"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { reachableTracks } from "@/lib/lookahead";
import { getSyncedVoiceMap } from "@/lib/syncedLyrics";
import { voiceMapFromStem, type VoiceMap } from "@/lib/voiceMap";
import { withTimeout } from "@/lib/withTimeout";

/** The playing track and the next few get a voice map; further ahead can wait its turn. */
const VOICE_LOOKAHEAD = 3;
const JOB_TIMEOUT_MS = 90_000;

/** Fetches and decodes a vocal stem, and reduces it to voiced stretches. Only the stretches are kept. */
async function voiceMapFromStemUrl(url: string): Promise<VoiceMap> {
  const AudioContextCtor =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioContextCtor();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`vocal stem fetch failed: ${res.status}`);
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    // Mix to mono (an average of the channels is plenty for "is there a voice").
    const mono = new Float32Array(buffer.length);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
    }
    return voiceMapFromStem(mono, buffer.sampleRate);
  } finally {
    void ctx.close();
  }
}

/**
 * Builds each upcoming track's voice map (lib/voiceMap.ts) — from its isolated vocal stem when it has one, otherwise
 * from time-stamped lyrics — so DualDeckStage can move on when the singing has stopped. One track at a time, nearest
 * first. A track whose lyrics-based map is later joined by a ready stem is rebuilt from the stem (more accurate).
 * Renders nothing.
 */
export function VoiceMapLoader() {
  const enabled = useStore((s) => s.voiceCut.enabled);
  const currentTrack = useStore((s) => s.currentTrack);
  const queue = useStore((s) => s.queue);
  const voiceMaps = useStore((s) => s.trackVoiceMaps);
  const stemAvailability = useStore((s) => s.stemAvailability);

  const busyRef = useRef(false);
  const stemTriedRef = useRef<Set<string>>(new Set());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || busyRef.current) return;
    for (const track of reachableTracks(currentTrack, queue, VOICE_LOOKAHEAD)) {
      if (track.source !== "local") continue; // YouTube tracks have neither a stem nor a file we can read
      const existing = voiceMaps[track.id]; // undefined = never tried, null = tried and nothing usable
      const stemUrl = stemAvailability[track.id];
      const wantsStem = Boolean(stemUrl) && !stemTriedRef.current.has(track.id) && existing?.source !== "stem";
      const wantsLyrics = existing === undefined;
      if (!wantsStem && !wantsLyrics) continue;

      busyRef.current = true;
      const fromLyrics = () =>
        withTimeout(getSyncedVoiceMap(track.title, track.artist, track.durationSec), JOB_TIMEOUT_MS, "Synced lyrics").catch(
          () => null
        );
      const job: Promise<VoiceMap | null> = wantsStem
        ? withTimeout(voiceMapFromStemUrl(stemUrl as string), JOB_TIMEOUT_MS, "Vocal stem").catch(async () => {
            stemTriedRef.current.add(track.id);
            // the stem couldn't be read: keep the lyrics-based map if there was one, otherwise try the lyrics
            return existing ?? (await fromLyrics());
          })
        : fromLyrics();
      void job
        .then((map) => {
          if (wantsStem) stemTriedRef.current.add(track.id);
          useStore.getState().setTrackVoiceMap(track.id, map);
        })
        .catch((err) => console.warn("Voice map bookkeeping failed:", err))
        .finally(() => {
          busyRef.current = false;
          setTick((t) => t + 1);
        });
      return; // one at a time
    }
  }, [enabled, currentTrack, queue, voiceMaps, stemAvailability, tick]);

  return null;
}
