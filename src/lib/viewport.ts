/**
 * Where the layout switches from the phone layout (no side panel or hamburger; the buttons under the player bar
 * navigate) to the desktop one (the side panel sits in the page, open until collapsed). Matches Tailwind's `md`
 * breakpoint, which the side panel's and bottom bar's own classes use, so the two can't disagree.
 */
export const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

/**
 * The side panel is open when the user chose so (true) or closed it (false); with no choice yet (null) it follows the
 * viewport: open on desktop. (A phone never displays it, whatever the choice.)
 */
export function sidebarShowing(choice: boolean | null, desktop: boolean): boolean {
  return choice ?? desktop;
}

/**
 * What the hamburger records: the opposite of whatever the user is looking at. Going back to the viewport's own default
 * (closing the drawer on a phone, reopening a collapsed panel on desktop) records no choice at all (null), so a choice
 * made on one layout doesn't linger after the window is resized or rotated into the other.
 */
export function toggledSidebarChoice(choice: boolean | null, desktop: boolean): boolean | null {
  const next = !sidebarShowing(choice, desktop);
  return next === desktop ? null : next;
}
