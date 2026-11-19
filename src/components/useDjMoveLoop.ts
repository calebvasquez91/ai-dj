"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { DeckId } from "@/types/music";
import type { TrackAnalysis } from "@/lib/audio-analysis";
import { useStore } from "@/lib/store";
import { useDjMoves } from "@/lib/djMovesStore";
import type { Track } from "@/types/music";

/** Everything a DJ move needs to know about the song playing and the deck it is on, at one tick. */
export interface DjMoveTick<Nodes> {
  track: Track;
  analysis: TrackAnalysis;
  ctx: AudioContext;
  master: GainNode | null;
  deckId: DeckId;
  nodes: Nodes;
  /** The other deck's nodes (the one a hand-off would come in on). */
  other: Nodes | null;
  el: HTMLAudioElement;
  /** The song's length, from its own file when that has loaded, else from the library. */
  durationSec: number;
  /** True on the first tick for this song (the move's own bookkeeping, such as the time of its last move, starts over). */
  newSong: boolean;
  moves: ReturnType<typeof useDjMoves.getState>;
  store: ReturnType<typeof useStore.getState>;
}

/**
 * The loop every automatic DJ move (EQ, stutter, scratch) runs in: while its feature flag is on, every `intervalMs`, and only while a song is
 * playing with its analysis ready and no transition running, it hands `onTick` the song, the deck and the audio context. The move itself (what to
 * plan and how to schedule it) is the caller's; nothing here runs at all when `enabled` is false, and an error in a move never reaches the music.
 * `onSkip` runs on a tick where nothing is playing, so a move can drop a request made while it could not be acted on.
 */
export function useDjMoveLoop<Nodes>(args: {
  enabled: boolean;
  intervalMs: number;
  audioCtxRef: MutableRefObject<AudioContext | null>;
  masterGainRef: MutableRefObject<GainNode | null>;
  deckNodesRef: MutableRefObject<Record<DeckId, Nodes | null>>;
  activeDeckRef: MutableRefObject<DeckId>;
  deckEl: (id: DeckId) => HTMLAudioElement | null;
  onTick: (tick: DjMoveTick<Nodes>) => void;
  onSkip?: () => void;
}): void {
  const { enabled, intervalMs, audioCtxRef, masterGainRef, deckNodesRef, activeDeckRef, deckEl } = args;
  // The latest callbacks, so the interval does not restart every render.
  const onTickRef = useRef(args.onTick);
  const onSkipRef = useRef(args.onSkip);
  useEffect(() => {
    onTickRef.current = args.onTick;
    onSkipRef.current = args.onSkip;
  });

  useEffect(() => {
    if (!enabled) return;
    useDjMoves.getState().load();
    let lastTrackId: string | null = null;
    const timer = setInterval(() => {
      try {
        const store = useStore.getState();
        const track = store.currentTrack;
        if (!track || !store.isPlaying || store.isTransitioning) return onSkipRef.current?.();
        const analysis = store.trackAnalysis[track.id];
        const ctx = audioCtxRef.current;
        const deckId = activeDeckRef.current;
        const nodes = deckNodesRef.current[deckId];
        const el = deckEl(deckId);
        if (!analysis || !ctx || !nodes || !el) return onSkipRef.current?.();
        const newSong = lastTrackId !== track.id;
        lastTrackId = track.id;
        onTickRef.current({
          track,
          analysis,
          ctx,
          master: masterGainRef.current,
          deckId,
          nodes,
          other: deckNodesRef.current[deckId === "A" ? "B" : "A"],
          el,
          durationSec: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : track.durationSec,
          newSong,
          moves: useDjMoves.getState(),
          store,
        });
      } catch {
        // a hiccup in a move must never reach the music
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, audioCtxRef, masterGainRef, deckNodesRef, activeDeckRef, deckEl]);
}
