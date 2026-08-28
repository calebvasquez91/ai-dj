"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  const router = useRouter();
  const createPlaylist = useStore((s) => s.createPlaylist);
  const toggleQueuePanel = useStore((s) => s.toggleQueuePanel);

  async function handleBuildPlaylist() {
    const id = await createPlaylist();
    router.push(`/playlist?id=${id}`);
  }

  return (
    <div className="p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl retro-heading">{greeting()}</h1>
        <div className="retro-stripe w-32" />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-accent-purple">Get started</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Link
            href="/library"
            className="card-retro hover:-translate-y-0.5 transition-transform p-4 flex items-center gap-4"
          >
            <div className="w-14 h-14 rounded-md bg-gradient-to-br from-accent-teal via-accent-purple to-accent-pink border-2 border-border shrink-0" />
            <p className="text-sm font-medium">Add local files to get started</p>
          </Link>

          <button
            type="button"
            onClick={handleBuildPlaylist}
            className="card-retro hover:-translate-y-0.5 transition-transform p-4 flex items-center gap-4 text-left"
          >
            <div className="w-14 h-14 rounded-md bg-gradient-to-br from-accent-teal via-accent-purple to-accent-pink border-2 border-border shrink-0" />
            <p className="text-sm font-medium">Build a playlist and let Auto-DJ blend it</p>
          </button>

          <button
            type="button"
            onClick={() => toggleQueuePanel()}
            className="card-retro hover:-translate-y-0.5 transition-transform p-4 flex items-center gap-4 text-left"
          >
            <div className="w-14 h-14 rounded-md bg-gradient-to-br from-accent-teal via-accent-purple to-accent-pink border-2 border-border shrink-0" />
            <p className="text-sm font-medium">Transitions get smoother the more you queue</p>
          </button>
        </div>
      </section>
    </div>
  );
}
