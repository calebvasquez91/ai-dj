import Link from "next/link";
import { notFound } from "next/navigation";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { classifiedLine, loadAdminOverview } from "@/lib/adminOverview";
import { formatDuration } from "@/lib/playStats";

export const metadata = { title: "Admin" };

function Card({ href, title, line, detail }: { href: string; title: string; line: string; detail: string }) {
  return (
    <Link href={href} className="card p-4 flex flex-col gap-1 hover:bg-surface-hover transition-colors">
      <span className="font-semibold">{title}</span>
      <span className="text-sm text-accent-purple">{line}</span>
      <span className="text-xs text-muted">{detail}</span>
    </Link>
  );
}

/**
 * The admin's home: one page with a way into every admin screen, each with the number you would want to see first. Same gate as
 * the pages it links to: only the accounts in ADMIN_USER_IDS may open it; for anyone else the page does not exist. The check comes
 * first, before anything is read.
 */
export default async function AdminPage() {
  if (!(await feedbackOwnerSession())) notFound();
  const o = await loadAdminOverview();

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6 max-w-3xl">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl heading">Admin</h1>
        <p className="text-sm text-muted">Only you can see this page and the screens it links to.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card
          href="/admin/feedback"
          title="Feedback inbox"
          line={o.feedbackCount == null ? "—" : `${o.feedbackCount.toLocaleString("en-US")} ${o.feedbackCount === 1 ? "message" : "messages"}`}
          detail="What people sent from the feedback pop-up, with the ratings."
        />
        <Card
          href="/admin/genres"
          title="Genre classification"
          line={classifiedLine(o)}
          detail="How well each genre source is doing, and how sure the results are."
        />
        <Card
          href="/library?view=review"
          title="Genre review"
          line={o.needsReview == null ? "—" : `${o.needsReview.toLocaleString("en-US")} waiting for a decision`}
          detail="Songs whose genre needs a person: accept a suggestion or pick another."
        />
        <Card
          href="/admin/stats"
          title="Listening"
          line={o.listenedSeconds == null ? "Not recording yet" : `${formatDuration(o.listenedSeconds)} played`}
          detail="Hours played by account, genre, playlist and song, for all time or the last 7 or 30 days."
        />
        <Card
          href="/admin/playlists"
          title="All playlists"
          line={o.playlists == null ? "—" : `${o.playlists.toLocaleString("en-US")} ${o.playlists === 1 ? "playlist" : "playlists"}`}
          detail="Every account's playlists, with full access: rename, take songs out, delete."
        />
        <Card
          href="/library"
          title="Music library"
          line={o.songs == null ? "—" : `${o.songs.toLocaleString("en-US")} songs`}
          detail="While you are signed in as the admin every song has a delete button and a tag button; FX sounds can be edited and deleted too."
        />
      </div>
    </div>
  );
}
