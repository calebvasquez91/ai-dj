import { notFound } from "next/navigation";
import { FeedbackInboxView } from "@/components/FeedbackInboxView";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { loadFeedbackInbox, parseInboxQuery } from "@/lib/feedbackInbox";

export const metadata = { title: "Feedback — AI DJ" };

/**
 * The owner's feedback inbox: what people sent from the feedback pop-up, newest first, with the average rating and how
 * the ratings split. Only the accounts in FEEDBACK_ADMIN_USER_IDS may open it; for anyone else the page does not exist
 * (a plain 404, so it doesn't even confirm there is an inbox). The check comes first, before anything is read.
 */
export default async function FeedbackInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[]; rating?: string | string[]; asof?: string | string[] }>;
}) {
  if (!(await feedbackOwnerSession())) notFound();

  const query = parseInboxQuery(await searchParams);
  const result = await loadFeedbackInbox(query);

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6 max-w-3xl">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl heading">Feedback</h1>
        <p className="text-sm text-muted">What people sent from the feedback pop-up. Only you can see this page.</p>
      </div>
      {result.ok ? (
        <FeedbackInboxView data={result.data} rating={query.rating} />
      ) : result.reason === "no-table" ? (
        <div className="card p-4 flex flex-col gap-2 text-sm" role="status">
          <p className="font-semibold">The feedback table doesn&apos;t exist yet.</p>
          <p className="text-muted">Nothing can be saved until it does. Create it once, from the project folder:</p>
          <code className="block rounded-lg bg-surface-hover px-3 py-2 text-xs break-all">npx prisma db execute --file prisma/feedback-table.sql</code>
        </div>
      ) : (
        <div className="card p-4 text-sm" role="alert">
          Couldn&apos;t load the feedback just now. Reload the page to try again; the details are in the server log.
        </div>
      )}
    </div>
  );
}
