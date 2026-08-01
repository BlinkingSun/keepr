/**
 * Missing-thumb placeholder label — pure classifier, no DOM.
 * Glyph-free text only; no emojis.
 */

import type { ItemType } from '../../shared/types.ts'

/**
 * Label for the letterbox when thumbSrc is null.
 *   document → "PDF"
 *   contact  → "Contact"
 *   receipt / default → "No image"
 */
export function placeholderLabel(
  type: ItemType | string | null | undefined,
): string {
  switch (type) {
    case 'document':
      return 'PDF'
    case 'contact':
      return 'Contact'
    case 'receipt':
    default:
      return 'No image'
  }
}

/**
 * Whether the card should render the placeholder branch.
 * Pure so tests can lock the branch without a renderer.
 */
export function needsPlaceholder(thumbSrc: string | null | undefined): boolean {
  return thumbSrc == null || thumbSrc === ''
}
