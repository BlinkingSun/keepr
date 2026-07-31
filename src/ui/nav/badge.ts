/**
 * Inbox count badge visibility.
 *
 * Zero means no badge (omit from the DOM). One or more shows the count.
 * Colour is a presentation concern (CSS uses --accent / --on-accent, never
 * --danger); this module only answers whether to render it.
 */
export function shouldShowInboxBadge(count: number): boolean {
  return count > 0
}
