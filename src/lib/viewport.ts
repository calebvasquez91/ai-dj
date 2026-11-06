/**
 * The three layouts. A phone (below 600px) navigates with the tabs under the player bar; a tablet (600-1023px) has an
 * icon rail down the left; a desktop (1024px and up) has the full side panel, open until collapsed, and a docked right
 * panel for the queue. These are the same numbers as `--breakpoint-tablet` and `--breakpoint-desktop` in globals.css,
 * which the `tablet:` and `desktop:` classes use (viewport.test.ts checks they agree).
 */
export const TABLET_MIN_WIDTH = 600;
export const DESKTOP_MIN_WIDTH = 1024;
export const TABLET_MEDIA_QUERY = `(min-width: ${TABLET_MIN_WIDTH}px)`;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

export type LayoutKind = "phone" | "tablet" | "desktop";

/** Which layout a viewport width gets. */
export function layoutForWidth(width: number): LayoutKind {
  if (width >= DESKTOP_MIN_WIDTH) return "desktop";
  if (width >= TABLET_MIN_WIDTH) return "tablet";
  return "phone";
}

/**
 * The side panel is open when the user chose so (true) or closed it (false); with no choice yet (null) it follows the
 * viewport: open on desktop. (Below the desktop width it is never displayed, whatever the choice: a tablet has the rail
 * and a phone has the tabs.)
 */
export function sidebarShowing(choice: boolean | null, desktop: boolean): boolean {
  return choice ?? desktop;
}

/**
 * What the hamburger records: the opposite of whatever the user is looking at. Going back to the viewport's own default
 * (reopening a collapsed panel on desktop) records no choice at all (null), so a choice made on one layout doesn't linger
 * after the window is resized into another.
 */
export function toggledSidebarChoice(choice: boolean | null, desktop: boolean): boolean | null {
  const next = !sidebarShowing(choice, desktop);
  return next === desktop ? null : next;
}
