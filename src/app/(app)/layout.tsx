import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthSessionProvider } from "@/components/AuthSessionProvider";
import { AppDataLoader } from "@/components/AppDataLoader";
import { StemAutopilot } from "@/components/StemAutopilot";
import { VoiceMapLoader } from "@/components/VoiceMapLoader";
import { STEM_FEATURES_ENABLED, VOCAL_MASHUP_ENABLED } from "@/lib/featureFlags";
import { MusicWaveBackground } from "@/components/MusicWaveBackground";
import { SpookyBackdrop } from "@/components/SpookyBackdrop";
import { Sidebar } from "@/components/Sidebar";
import { NavRail } from "@/components/NavRail";
import { TopBar } from "@/components/TopBar";
import { PlayerBar } from "@/components/PlayerBar";
import { BottomNav } from "@/components/BottomNav";
import { QUE_ENABLED, QueDock } from "@/features/que";
import { NowPlayingView } from "@/components/NowPlayingView";
import { QueuePanel } from "@/components/QueuePanel";
import { DeckView } from "@/components/DeckView";
import { Mixer } from "@/components/Mixer";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { BackgroundAudio } from "@/components/BackgroundAudio";
import { FeedbackPrompt } from "@/components/FeedbackPrompt";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <AuthSessionProvider>
      <AppDataLoader />
      {STEM_FEATURES_ENABLED && <StemAutopilot />}
      {!STEM_FEATURES_ENABLED && VOCAL_MASHUP_ENABLED && <StemAutopilot scope="mashup-next" />}
      {(STEM_FEATURES_ENABLED || VOCAL_MASHUP_ENABLED) && <VoiceMapLoader />}
      <KeyboardShortcuts />
      <BackgroundAudio />
      <SpookyBackdrop />
      <MusicWaveBackground />
      <div className="flex flex-1 min-h-0">
        <NavRail />
        <Sidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <TopBar />
          {/* overflow-x-hidden: an overflow-y scroll container silently
              becomes horizontally scrollable too, which is how one
              too-wide child made whole pages slide sideways. Page
              content is built to fit; this is the backstop. */}
          <main className="flex-1 overflow-y-auto overflow-x-hidden pb-[var(--que-lane-h)]">{children}</main>
        </div>
        {/* Docked here at the desktop width (a column of its own, collapsible); an overlay from the right below it. */}
        <QueuePanel />
      </div>
      <PlayerBar />
      <BottomNav />
      {QUE_ENABLED && <QueDock />}
      <NowPlayingView />
      <DeckView />
      <Mixer />
      <FeedbackPrompt />
    </AuthSessionProvider>
  );
}
