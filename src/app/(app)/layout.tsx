import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthSessionProvider } from "@/components/AuthSessionProvider";
import { AppDataLoader } from "@/components/AppDataLoader";
import { MusicWaveBackground } from "@/components/MusicWaveBackground";
import { SpookyBackdrop } from "@/components/SpookyBackdrop";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { PlayerBar } from "@/components/PlayerBar";
import { NowPlayingView } from "@/components/NowPlayingView";
import { QueuePanel } from "@/components/QueuePanel";
import { DeckView } from "@/components/DeckView";
import { Mixer } from "@/components/Mixer";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <AuthSessionProvider>
      <AppDataLoader />
      <KeyboardShortcuts />
      <SpookyBackdrop />
      <MusicWaveBackground />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <TopBar />
          {/* overflow-x-hidden: an overflow-y scroll container silently
              becomes horizontally scrollable too, which is how one
              too-wide child made whole pages slide sideways. Page
              content is built to fit; this is the backstop. */}
          <main className="flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
        </div>
      </div>
      <PlayerBar />
      <NowPlayingView />
      <QueuePanel />
      <DeckView />
      <Mixer />
    </AuthSessionProvider>
  );
}
