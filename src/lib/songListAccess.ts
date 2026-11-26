/**
 * Two small rules about the owner's song list that must not be wrong, kept apart from the database code so they can be tested:
 *  - who may see suggestions from it (the admin account only: it is a personal list, and the repo and the other accounts are not the owner's), and
 *  - which database errors mean "the table is not there yet" (Create with DJ then simply shows no list section) and which are a real problem (logged, never hidden).
 */
import { isAdmin } from "@/lib/feedbackAdmin";

/** The loader when `userId` is the admin, otherwise undefined. The route passes this straight to the curator, so only the admin is ever sent list suggestions. */
export function songListLoaderFor<T>(userId: string | null | undefined, loader: T, env: Record<string, string | undefined> = process.env): T | undefined {
  return isAdmin(userId, env) ? loader : undefined;
}

/** True when `err` is the database saying a table does not exist (Prisma P2021, Postgres 42P01 as the driver adapter reports it, or its message). Nothing else counts. */
export function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; kind?: unknown } } } };
  if (e.code === "P2021" || e.code === "42P01") return true;
  const cause = e.meta?.driverAdapterError?.cause;
  if (cause?.originalCode === "42P01" || cause?.kind === "TableDoesNotExist") return true;
  return typeof e.message === "string" && /relation "?[\w."]+"? does not exist|table [`"']?[\w."]+[`"']? does not exist|\b42P01\b|\bP2021\b/i.test(e.message);
}
