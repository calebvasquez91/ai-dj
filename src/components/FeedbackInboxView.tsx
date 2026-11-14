import Link from "next/link";
import { LocalTime } from "@/components/LocalTime";
import { StarIcon } from "@/components/Icons";
import { barPercent, describeUserAgent, formatAverage, type InboxData, type InboxItem } from "@/lib/feedbackInbox";

/** The inbox's address for a page and a rating filter (the defaults are left out). */
export function inboxHref(page: number, rating: number | null): string {
  const params = new URLSearchParams();
  if (rating !== null) params.set("rating", String(rating));
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/feedback?${qs}` : "/admin/feedback";
}

function Stars({ rating, size = 18 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5 text-accent-pink" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} size={size} filled={n <= rating} className={n <= rating ? "" : "text-muted"} />
      ))}
    </span>
  );
}

function FeedbackCard({ item }: { item: InboxItem }) {
  const who = item.user.name ? `${item.user.name} (${item.user.email})` : item.user.email;
  return (
    <li className="card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Stars rating={item.rating} />
        <LocalTime iso={item.createdAt} className="text-xs text-muted" />
      </div>
      {item.comment ? <p className="text-sm whitespace-pre-wrap break-words">{item.comment}</p> : <p className="text-sm text-muted">No comment</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="break-all">{who}</span>
        <a
          href={`mailto:${item.user.email}?subject=${encodeURIComponent("Re: your feedback on AI DJ")}`}
          className="text-accent-purple hover:text-accent-pink"
        >
          Reply
        </a>
        {item.page && <span>on {item.page}</span>}
        {item.appVersion && <span>build {item.appVersion}</span>}
        <span title={item.userAgent ?? undefined}>{describeUserAgent(item.userAgent)}</span>
        <span>{item.emailedAt ? "emailed to you" : "not emailed"}</span>
      </div>
    </li>
  );
}

/** The inbox itself: the summary, the rating filter, one page of submissions and the paging links. Rendered on the server; it is only links. */
export function FeedbackInboxView({ data, rating }: { data: InboxData; rating: number | null }) {
  const maxBucket = Math.max(...Object.values(data.distribution));
  return (
    <div className="flex flex-col gap-6">
      <section className="card p-4 sm:p-5 grid gap-5 sm:grid-cols-[auto_1fr] items-center" aria-label="Summary">
        <div className="flex flex-col gap-1 sm:pr-6">
          <span className="text-4xl heading">{formatAverage(data.average)}</span>
          {data.average !== null && <Stars rating={Math.round(data.average)} size={20} />}
          <span className="text-xs text-muted">
            {data.allTotal} {data.allTotal === 1 ? "submission" : "submissions"} · {data.recent} in the last 30 days
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {([5, 4, 3, 2, 1] as const).map((n) => (
            <Link
              key={n}
              href={inboxHref(1, n)}
              aria-label={`${data.distribution[n]} ${n}-star ${data.distribution[n] === 1 ? "rating" : "ratings"}: show only these`}
              className="flex items-center gap-2 text-sm text-muted hover:text-foreground"
            >
              <span className="w-8 shrink-0 tabular-nums">{n} ★</span>
              <span className="h-2 flex-1 rounded-full bg-surface-hover overflow-hidden" aria-hidden="true">
                <span className="block h-full rounded-full bg-accent-pink" style={{ width: `${barPercent(data.distribution[n], maxBucket)}%` }} />
              </span>
              <span className="w-8 shrink-0 text-right tabular-nums">{data.distribution[n]}</span>
            </Link>
          ))}
        </div>
      </section>

      <nav className="flex flex-wrap gap-2" aria-label="Filter by rating">
        {[null, 5, 4, 3, 2, 1].map((n) => (
          <Link
            key={n ?? "all"}
            href={inboxHref(1, n)}
            aria-current={rating === n ? "page" : undefined}
            data-active={rating === n}
            className="btn-outline !px-3 !py-1 text-xs"
          >
            {n === null ? "All" : `${n} ★`}
          </Link>
        ))}
      </nav>

      {data.items.length === 0 ? (
        <p className="text-sm text-muted">{rating === null ? "No feedback yet. It will show up here as people send it." : `No ${rating}-star feedback.`}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((item) => (
            <FeedbackCard key={item.id} item={item} />
          ))}
        </ul>
      )}

      {data.pageCount > 1 && (
        <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Pages">
          {data.page > 1 ? (
            <Link href={inboxHref(data.page - 1, rating)} className="btn-outline !px-3 !py-1">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {data.page} of {data.pageCount}
          </span>
          {data.page < data.pageCount ? (
            <Link href={inboxHref(data.page + 1, rating)} className="btn-outline !px-3 !py-1">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
