import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthSessionProvider } from "@/components/AuthSessionProvider";
import { AppDataLoader } from "@/components/AppDataLoader";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { PlayerBar } from "@/components/PlayerBar";
import { NowPlayingView } from "@/components/NowPlayingView";
import { QueuePanel } from "@/components/QueuePanel";
import { DeckView } from "@/components/DeckView";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <AuthSessionProvider>
      <AppDataLoader />
      <KeyboardShortcuts />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <TopBar />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
      <PlayerBar />
      <NowPlayingView />
      <QueuePanel />
      <DeckView />
    </AuthSessionProvider>
  );
}
