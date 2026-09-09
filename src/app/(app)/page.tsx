"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { Que } from "@/components/Que";
import { shuffleForPlay } from "@/lib/shuffle";

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  const router = useRouter();
  const createPlaylist = useStore((s) => s.createPlaylist);
  const toggleQueuePanel = useStore((s) => s.toggleQueuePanel);
  const localLibrary = useStore((s) => s.localLibrary);
  const trackAnalysis = useStore((s) => s.trackAnalysis);
  const trackLyricalFingerprints = useStore((s) => s.trackLyricalFingerprints);
  const playTrackList = useStore((s) => s.playTrackList);
  const getStartedRef = useRef<HTMLDivElement>(null);
  // Computed only after mount, from the *client's* local time — computing
  // this directly during render would run once during SSR (the server's
  // clock/timezone) and again during hydration (the browser's), and the two
  // can disagree right at an hour boundary or across timezones, which React
  // treats as a hard hydration mismatch in production. A stable "Hello"
  // matches on both passes; the real greeting swaps in right after.
  const [greeting, setGreeting] = useState("Hello");
  useEffect(() => {
    // One-shot, deliberately synchronous: reads the client's clock exactly
    // once after mount so it never runs during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);

  const shufflableCount = localLibrary.filter((t) => t.playPreference !== "do-not").length;

  function handleShuffle() {
    playTrackList(shuffleForPlay(localLibrary, trackAnalysis, trackLyricalFingerprints), 0);
  }

  async function handleBuildPlaylist() {
    const id = await createPlaylist();
    router.push(`/playlist?id=${id}`);
  }

  return (
    <div className="flex flex-col">
      <section className="home-hero relative min-h-[80vh] flex flex-col items-center justify-center gap-6 px-6 text-center">
        <span className="home-hero-eyebrow">AI DJ</span>
        <h1 className="home-hero-heading">{greeting}</h1>
        <p className="home-hero-subtitle">Your library, mixed into one continuous set.</p>
        <Que size={96} welcomeMessage="Cue something up — I've got the transitions covered." />
        <button
          type="button"
          onClick={handleShuffle}
          disabled={shufflableCount < 2}
          className="btn home-hero-shuffle"
        >
          🔀 Shuffle Play
        </button>
        <button
          type="button"
          onClick={() => getStartedRef.current?.scrollIntoView({ behavior: "smooth" })}
          className="home-hero-scroll-cue"
          title="Scroll down"
          aria-label="Scroll down to Get started"
        >
          ⌄
        </button>
      </section>

      <div ref={getStartedRef} className="p-6 flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-accent-purple">Get started</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Link
              href="/library"
              className="card hover:-translate-y-0.5 transition-transform p-4 flex items-center gap-4"
            >
              <div className="w-14 h-14 rounded-md bg-gradient-to-br from-accent-teal to-accent-purple shadow-elevate-sm shrink-0" />
              <p className="text-sm font-medium">Add local files to get started</p>
            </Link>

            <button
              type="button"
              onClick={handleBuildPlaylist}
              className="card hover:-translate-y-0.5 transition-transform p-4 flex items-center gap-4 text-left"
            >
              <div className="w-14 h-14 rounded-md bg-gradient-to-br from-accent-teal to-accent-purple shadow-elevate-sm shrink-0" />
              <p className="text-sm font-medium">Build a playlist and let Auto-DJ blend it</p>
            </button>

            <button
              type="button"
              onClick={() => toggleQueuePanel()}
              className="card hover:-translate-y-0.5 transition-transform p-4 flex items-center gap-4 text-left"
            >
              <div className="w-14 h-14 rounded-md bg-gradient-to-br from-accent-teal to-accent-purple shadow-elevate-sm shrink-0" />
              <p className="text-sm font-medium">Transitions get smoother the more you queue</p>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
