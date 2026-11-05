/**
 * The four buttons under the player bar on a phone. Pure so which one is lit for a given page is unit-tested; the icons
 * and the markup live in components/BottomNav.tsx.
 */
export interface NavTab {
  href: string;
  label: string;
}

export const NAV_TABS: readonly NavTab[] = [
  { href: "/", label: "Home" },
  { href: "/library", label: "Music Library" },
  { href: "/playlists", label: "Playlists" },
  { href: "/search", label: "Search" },
];

/** The tab a page belongs to, or null for a page none of them owns (DJ Inspiration). A single playlist belongs to Playlists. */
export function activeTabHref(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/playlist") return "/playlists";
  return NAV_TABS.some((t) => t.href === path) ? path : null;
}
