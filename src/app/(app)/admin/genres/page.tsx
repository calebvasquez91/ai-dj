import { notFound } from "next/navigation";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { loadGenreStats } from "@/lib/genre/statsServer";
import { GenreStatsView } from "@/components/GenreStatsView";

export const metadata = { title: "Genre classification" };

/**
 * The owner's view of how genre classification is doing: how much of the library has a genre, how much needs review, how
 * often each source finds something and how sure the results are. Same gate as the feedback inbox: only the accounts in
 * FEEDBACK_ADMIN_USER_IDS may open it; for anyone else the page does not exist. The check comes first.
 */
export default async function GenreStatsPage() {
  if (!(await feedbackOwnerSession())) notFound();
  const result = await loadGenreStats();

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6 max-w-3xl">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl heading">Genre classification</h1>
        <p className="text-sm text-muted">How well the genre sources are doing across every account. Only you can see this page.</p>
      </div>
      {result.ok ? (
        <GenreStatsView stats={result.stats} />
      ) : result.reason === "no-table" ? (
        <div className="card p-4 flex flex-col gap-2 text-sm" role="status">
          <p className="font-semibold">The genre tables don&apos;t exist yet.</p>
          <p className="text-muted">Nothing is classified until they do. Create them once, from the project folder:</p>
          <code className="block rounded-lg bg-surface-hover px-3 py-2 text-xs break-all">npx prisma db execute --file prisma/genre-tables.sql</code>
        </div>
      ) : (
        <div className="card p-4 text-sm" role="alert">
          Couldn&apos;t load the numbers just now. Reload the page to try again; the details are in the server log.
        </div>
      )}
    </div>
  );
}
