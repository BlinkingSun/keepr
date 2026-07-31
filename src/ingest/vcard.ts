/**
 * Minimal vCard 2.1 / 3.0 / 4.0 parser — no extra dependencies.
 * Enough to land contacts with name + email (acceptance test 11).
 */

export interface ParsedVCard {
  firstName: string | null
  lastName: string | null
  org: string | null
  title: string | null
  emails: string[]
  phones: string[]
  addresses: string[]
  url: string | null
  notes: string | null
  /** Display / full name when FN is present. */
  fn: string | null
}

/**
 * Split a .vcf buffer into individual cards and parse each.
 * Unfolds line continuations (leading space/tab after CRLF).
 */
export function parseVCards(raw: string | Buffer): ParsedVCard[] {
  const text = (typeof raw === 'string' ? raw : raw.toString('utf8'))
    // Unfold: CRLF + whitespace continuation
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '')
    .replace(/\r/g, '\n')

  const cards: ParsedVCard[] = []
  let current: string[] | null = null

  for (const line of text.split('\n')) {
    const trimmed = line.trimEnd()
    if (/^BEGIN:VCARD$/i.test(trimmed)) {
      current = []
      continue
    }
    if (/^END:VCARD$/i.test(trimmed)) {
      if (current) cards.push(parseOneCard(current))
      current = null
      continue
    }
    if (current) current.push(trimmed)
  }

  return cards
}

function parseOneCard(lines: string[]): ParsedVCard {
  const out: ParsedVCard = {
    firstName: null,
    lastName: null,
    org: null,
    title: null,
    emails: [],
    phones: [],
    addresses: [],
    url: null,
    notes: null,
    fn: null,
  }

  for (const line of lines) {
    if (!line || line.startsWith(' ')) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const left = line.slice(0, colon)
    const value = unescapeVCard(line.slice(colon + 1).trim())
    const semi = left.indexOf(';')
    const name = (semi >= 0 ? left.slice(0, semi) : left).toUpperCase()
    // Drop group prefix (e.g. item1.EMAIL)
    const prop = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name

    switch (prop) {
      case 'N': {
        // N:Last;First;Middle;Prefix;Suffix
        const parts = value.split(';')
        out.lastName = emptyToNull(parts[0] ?? '')
        out.firstName = emptyToNull(parts[1] ?? '')
        break
      }
      case 'FN':
        out.fn = emptyToNull(value)
        break
      case 'ORG':
        out.org = emptyToNull(value.split(';')[0] ?? value)
        break
      case 'TITLE':
        out.title = emptyToNull(value)
        break
      case 'EMAIL':
        if (value) out.emails.push(value)
        break
      case 'TEL':
        if (value) out.phones.push(value)
        break
      case 'ADR': {
        // ADR:;;street;city;region;postal;country — join non-empty for display
        const bits = value.split(';').map((s) => s.trim()).filter(Boolean)
        if (bits.length) out.addresses.push(bits.join(', '))
        break
      }
      case 'URL':
        if (value && !out.url) out.url = value
        break
      case 'NOTE':
        out.notes = emptyToNull(value)
        break
      default:
        break
    }
  }

  // FN fallback when N is empty
  if (!out.firstName && !out.lastName && out.fn) {
    const bits = out.fn.split(/\s+/)
    if (bits.length === 1) {
      out.firstName = bits[0] ?? null
    } else {
      out.firstName = bits.slice(0, -1).join(' ') || null
      out.lastName = bits[bits.length - 1] ?? null
    }
  }

  return out
}

function emptyToNull(s: string): string | null {
  const t = s.trim()
  return t ? t : null
}

function unescapeVCard(s: string): string {
  return s
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}
