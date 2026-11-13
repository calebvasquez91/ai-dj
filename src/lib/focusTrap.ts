/**
 * Keeping Tab inside a modal dialog. Pure: given the dialog's focusable elements, where focus is now and which way Tab
 * is going, it says which element to move to, or null when the browser's own Tab order is already right (somewhere in
 * the middle of the list). Focus that is outside the list (on the dialog itself, say) goes to the first or last item.
 */
export function cycleFocus<T>(items: readonly T[], active: unknown, backwards: boolean): T | null {
  if (items.length === 0) return null;
  const index = items.indexOf(active as T);
  if (index === -1) return backwards ? items[items.length - 1] : items[0];
  if (backwards && index === 0) return items[items.length - 1];
  if (!backwards && index === items.length - 1) return items[0];
  return null;
}
