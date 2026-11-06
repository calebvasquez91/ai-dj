"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useLiked } from "@/lib/liked";
import { likedTracks } from "@/lib/library";
import { buildMixes, tracksForMood } from "@/lib/moods";
import { HOME_CHIPS, chipView, mixedForYou, pinnedFirst, quickPicks, recentlyAdded, recentlyPlayed, type HomeChip } from "@/lib/homeSections";
import { coverGradient } from "@/lib/coverGradient";
import { PlayIcon, ShuffleIcon, SparklesIcon } from "@/components/Icons";
import { Card, Carousel, Chip, ChipRow, CoverArt, MediaCard, PagedGrid, SectionHeader, Skeleton, Text, Tile, usePullToRefresh } from "@/ui";
import type { Track } from "@/types/music";

/** One card in the "Choose a mix" carousel: an AI-DJ mood mix, Spooky Music, or Same Beat. */
interface MixCardData {
  key: string;
  title: string;
  subtitle: string;
  seed: string;
  spooky: boolean;
  play: () => void;
}

function MixCard({ mix }: { mix: MixCardData }) {
  return (
    <button
      type="button"
      onClick={mix.play}
      aria-label={`Play ${mix.title}, ${mix.subtitle}`}
      className="relative flex h-44 w-full flex-col justify-end overflow-hidden rounded-card p-4 text-left text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      style={{ background: mix.spooky ? "linear-gradient(135deg, #1a0500, #3d1200)" : coverGradient(mix.seed) }}
    >
      {mix.spooky && (
        <span className="absolute left-4 top-4 text-3xl" aria-hidden="true">
          🎃
        </span>
      )}
      <span className="text-xl font-bold tracking-tight">{mix.title}</span>
      <span className="text-sm text-white/75">{mix.subtitle}</span>
      <span aria-hidden="true" className="accent-gradient absolute bottom-4 right-4 flex h-12 w-12 items-center justify-center rounded-full text-background">
        <PlayIcon size={20} className="translate-x-0.5" />
      </span>
    </button>
  );
}

function TrackCard({ track, onPlay }: { track: Track; onPlay: () => void }) {
  return <MediaCard cover={<CoverArt title={track.title} src={track.thumbnailUrl} />} title={track.title} subtitle={track.artist} onClick={onPlay} />;
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading your library">
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-20 !rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 desktop:grid-cols-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14 !rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-44" />
      <div className="flex gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="aspect-square w-36 shrink-0" />
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const localLibrary = useStore((s) => s.localLibrary);
  const libraryLoaded = useStore((s) => s.libraryLoaded);
  const history = useStore((s) => s.history);
  const playlists = useStore((s) => s.playlists);
  const trackAnalysis = useStore((s) => s.trackAnalysis);
  const createPlaylist = useStore((s) => s.createPlaylist);
  const startShuffle = useStore((s) => s.startShuffle);
  const playTrackList = useStore((s) => s.playTrackList);
  const playPlaylist = useStore((s) => s.playPlaylist);
  const likedIds = useLiked((s) => s.ids);
  const [chip, setChip] = useState<HomeChip>("all");
  const view = chipView(chip);

  const { rootRef, offset, refreshing } = usePullToRefresh(async () => {
    const { loadLibrary, loadPlaylists } = useStore.getState();
    await Promise.all([loadLibrary(), loadPlaylists()]);
  });

  const mixes = useMemo(() => buildMixes(localLibrary, trackAnalysis), [localLibrary, trackAnalysis]);
  // With a mood chip on, every song row narrows to that mood's songs.
  const moodIds = useMemo(
    () => (view.mood ? new Set(tracksForMood(localLibrary, trackAnalysis, view.mood).map((t) => t.id)) : null),
    [localLibrary, trackAnalysis, view.mood]
  );
  const narrow = useCallback((tracks: Track[]) => (moodIds ? tracks.filter((t) => moodIds.has(t.id)) : tracks), [moodIds]);

  const picks = useMemo(() => narrow(quickPicks(localLibrary, history)), [narrow, localLibrary, history]);
  const added = useMemo(() => narrow(recentlyAdded(localLibrary, 12)), [narrow, localLibrary]);
  const played = useMemo(() => narrow(recentlyPlayed(history, 12)), [narrow, history]);
  const mixed = useMemo(() => narrow(mixedForYou(localLibrary, history, 12)), [narrow, localLibrary, history]);

  const pinned = useMemo(() => pinnedFirst(playlists).slice(0, 6), [playlists]);
  const mixCards = useMemo<MixCardData[]>(() => {
    const moodCards = mixes
      .filter((m) => !view.mood || m.mood === view.mood)
      .map((m) => ({
        key: m.mood,
        title: `${m.label} mix`,
        subtitle: `${m.tracks.length} songs, built by the AI DJ`,
        seed: m.label,
        spooky: false,
        play: () => playTrackList(m.tracks, 0),
      }));
    if (view.mood) return moodCards;
    const named = playlists
      .filter((p) => (p.theme === "spooky" || p.name.trim().toLowerCase() === "same beat") && p.tracks.length > 0)
      .map((p) => ({
        key: p.id,
        title: p.name,
        subtitle: `${p.tracks.length} song${p.tracks.length === 1 ? "" : "s"}`,
        seed: p.name,
        spooky: p.theme === "spooky",
        play: () => playPlaylist(p),
      }));
    return [...moodCards, ...named];
  }, [mixes, playlists, view.mood, playTrackList, playPlaylist]);

  async function handleBuildPlaylist() {
    const id = await createPlaylist();
    if (id) router.push(`/playlist?id=${id}`);
  }

  // Likes of songs that have since left the library don't count: the tile would open an empty list.
  const likedCount = useMemo(() => likedTracks(localLibrary, likedIds).length, [localLibrary, likedIds]);
  const canShuffle = localLibrary.filter((t) => t.playPreference !== "do-not").length >= 2;
  const hasSongRows = picks.length + added.length + played.length + mixed.length > 0;

  return (
    <div ref={rootRef} className="flex flex-col gap-6 px-4 py-4 sm:px-6">
      <div
        className="-mb-6 flex items-end justify-center overflow-hidden text-xs text-muted transition-[height] motion-reduce:transition-none"
        style={{ height: refreshing ? 36 : offset }}
        aria-live="polite"
      >
        {refreshing ? "Refreshing…" : offset > 0 ? "Pull to refresh" : ""}
      </div>

      {!libraryLoaded ? (
        <HomeSkeleton />
      ) : localLibrary.length === 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeader title="Get started" level={1} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 desktop:grid-cols-3">
            <Card href="/library">
              <Text variant="heading">Add music</Text>
              <Text variant="secondary" className="mt-1">Upload local files to your library.</Text>
            </Card>
            <Card onClick={handleBuildPlaylist}>
              <Text variant="heading">Build a playlist</Text>
              <Text variant="secondary" className="mt-1">Let Auto-DJ blend it.</Text>
            </Card>
            <Card href="/settings">
              <Text variant="heading">Settings</Text>
              <Text variant="secondary" className="mt-1">Choose dark, light or your device&apos;s setting.</Text>
            </Card>
          </div>
        </section>
      ) : (
        <>
          <h1 className="sr-only">Home</h1>
          <ChipRow label="Filter Home">
            {HOME_CHIPS.map((c) => (
              <Chip key={c.id} selected={chip === c.id} onClick={() => setChip(c.id)}>
                {c.label}
              </Chip>
            ))}
          </ChipRow>

          {!view.mood && (
            <section aria-label="Quick access" className="grid grid-cols-2 gap-2 desktop:grid-cols-4">
              <Tile
                cover={
                  <span className="flex h-full w-full items-center justify-center bg-surface-hover text-accent">
                    <ShuffleIcon size={22} />
                  </span>
                }
                title="Shuffle Play"
                onClick={canShuffle ? () => startShuffle(localLibrary) : undefined}
                className={canShuffle ? undefined : "pointer-events-none opacity-50"}
              />
              {likedCount > 0 && (
                <Tile
                  cover={
                    <span className="flex h-full w-full items-center justify-center bg-surface-hover text-accent-pink">
                      <SparklesIcon size={22} />
                    </span>
                  }
                  title="Liked Songs"
                  href="/library?view=liked"
                />
              )}
              {pinned.map((p) => (
                <Tile
                  key={p.id}
                  cover={<CoverArt title={p.name} src={p.tracks[0]?.thumbnailUrl} />}
                  title={p.name}
                  href={`/playlist?id=${p.id}`}
                />
              ))}
            </section>
          )}

          {view.showMixes && mixCards.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader title="Choose a mix" />
              <Carousel label="Choose a mix" itemClassName="w-[85%] sm:w-80" dots>
                {mixCards.map((m) => (
                  <MixCard key={m.key} mix={m} />
                ))}
              </Carousel>
            </section>
          )}

          {view.showMusic && picks.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader title="Quick picks" />
              <PagedGrid
                label="Quick picks"
                items={picks}
                getKey={(t) => t.id}
                renderItem={(t, i) => (
                  <MediaCard
                    cover={<CoverArt title={t.title} src={t.thumbnailUrl} />}
                    title={t.title}
                    subtitle={t.artist}
                    onClick={() => playTrackList(picks, i)}
                  />
                )}
              />
            </section>
          )}

          {view.showMusic && added.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader title="Recently added" />
              <Carousel label="Recently added" itemClassName="w-36">
                {added.map((t, i) => (
                  <TrackCard key={t.id} track={t} onPlay={() => playTrackList(added, i)} />
                ))}
              </Carousel>
            </section>
          )}

          {view.showMusic && played.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader title="Recently played" />
              <Carousel label="Recently played" itemClassName="w-36">
                {played.map((t, i) => (
                  <TrackCard key={t.id} track={t} onPlay={() => playTrackList(played, i)} />
                ))}
              </Carousel>
            </section>
          )}

          {view.showMusic && mixed.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader title="Mixed for you" />
              <Carousel label="Mixed for you" itemClassName="w-36">
                {mixed.map((t, i) => (
                  <TrackCard key={t.id} track={t} onPlay={() => playTrackList(mixed, i)} />
                ))}
              </Carousel>
            </section>
          )}

          {view.mood && !hasSongRows && mixCards.length === 0 && (
            <Text variant="secondary">Nothing in your library fits this mood yet. Songs get a mood from their tempo, their loudness or a tag like &quot;chill&quot;.</Text>
          )}
        </>
      )}
    </div>
  );
}
