// The searches a person has submitted lately, newest first, offered under the empty search box. Kept in this browser only (a convenience, not
// an account feature): localStorage, read and written defensively since it can be missing, full or blocked. Pure list logic plus thin storage
// helpers that take the storage as an argument, so both are testable.

export const RECENT_SEARCH_KEY = "ai-dj:recent-searches";
export const RECENT_SEARCH_LIMIT = 8;
const MAX_LENGTH = 80;

/** The text to remember for a submitted query: trimmed, with runs of spaces collapsed; null when it is too short to be worth keeping. */
export function cleanRecentSearch(query: string): string | null {
  const text = query.replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
  return text.length >= 2 ? text : null;
}

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** The list with `query` moved to the front (a repeat of it, in any case, is replaced), capped. Unchanged when the query is not worth keeping. */
export function addRecentSearch(list: readonly string[], query: string): string[] {
  const text = cleanRecentSearch(query);
  if (!text) return [...list];
  return [text, ...list.filter((q) => !same(q, text))].slice(0, RECENT_SEARCH_LIMIT);
}

export function removeRecentSearch(list: readonly string[], query: string): string[] {
  return list.filter((q) => !same(q, query));
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** What is stored, or [] when nothing usable is (a missing, unreadable or corrupt value). */
export function loadRecentSearches(storage: StorageLike | null | undefined): string[] {
  try {
    const raw = storage?.getItem(RECENT_SEARCH_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is string => typeof q === "string" && cleanRecentSearch(q) != null).slice(0, RECENT_SEARCH_LIMIT);
  } catch {
    return [];
  }
}

export function saveRecentSearches(storage: StorageLike | null | undefined, list: readonly string[]): void {
  try {
    storage?.setItem(RECENT_SEARCH_KEY, JSON.stringify(list.slice(0, RECENT_SEARCH_LIMIT)));
  } catch {
    // Storage full or blocked: the list just is not kept this time.
  }
}
