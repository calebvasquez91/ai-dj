import Link from "next/link";
import { notFound } from "next/navigation";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { AdminMusicTable } from "@/components/AdminMusicTable";

export const metadata = { title: "Music catalog" };

/**
 * The admin's Music catalog: every song with its artist, name, genre, plays, tags, BPM and key in one searchable, editable table. Only the
 * admin; for anyone else the page does not exist. The check comes first, before anything is read (the table loads its own rows from
 * /api/admin/music, which makes the same check).
 */
export default async function AdminMusicPage() {
  if (!(await feedbackOwnerSession())) notFound();
  return (
    <div className="p-3 sm:p-6 flex flex-col gap-4 min-w-0">
      <div className="flex flex-col gap-1">
        <nav aria-label="Breadcrumb" className="text-xs text-muted">
          <Link href="/admin" className="hover:text-foreground">
            Admin
          </Link>{" "}
          / Music catalog
        </nav>
        <h1 className="text-2xl heading">QueDJ Music Admin</h1>
        <p className="text-sm text-muted">Every song in the app. Search it, sort it, and fix what is missing: changes are saved for every account.</p>
      </div>
      <AdminMusicTable />
    </div>
  );
}
