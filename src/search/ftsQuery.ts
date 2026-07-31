/**
 * FTS5 query sanitisation for KeepR search.
 *
 * User input must never become an FTS5 operator by accident. A bare `"`, `*`,
 * or `AND` would otherwise throw or change meaning. Every token is quoted as a
 * phrase; trailing `*` is preserved as a prefix operator; leading `*` is
 * rejected with a clear reason.
 */

export class SearchQueryError extends Error {
  readonly code = 'SEARCH_QUERY' as const
  constructor(message: string) {
    super(message)
    this.name = 'SearchQueryError'
  }
}

export type FtsMatchBuild =
  | { ok: true; match: string }
  | { ok: false; reason: string }

/**
 * Turn free-text user input into a safe FTS5 MATCH expression.
 * Tokens are AND-ed (FTS5 default for space-separated terms).
 * Empty / whitespace-only input yields match: '' (structured filters only).
 */
export function buildFtsMatch(userQuery: string): FtsMatchBuild {
  const trimmed = userQuery.trim()
  if (!trimmed) return { ok: true, match: '' }

  const tokens = trimmed.split(/\s+/).filter(Boolean)
  const parts: string[] = []

  for (const raw of tokens) {
    if (raw.startsWith('*')) {
      return {
        ok: false,
        reason:
          'Leading wildcards are not allowed; use a trailing * for prefix match (e.g. home*)',
      }
    }

    let prefix = false
    let core = raw
    if (core.endsWith('*')) {
      // Bare "*" has no stem — reject rather than match everything.
      if (core.length === 1) {
        return {
          ok: false,
          reason:
            'Bare * is not allowed; use a term with trailing * for prefix match (e.g. home*)',
        }
      }
      prefix = true
      core = core.slice(0, -1)
    }

    // Strip a single pair of user-supplied wrapping quotes so we control quoting.
    if (core.length >= 2 && core.startsWith('"') && core.endsWith('"')) {
      core = core.slice(1, -1)
    }

    // Bare `"` / `""` / quote-only tokens: nothing to search for — skip.
    // Emitting them as phrases either errors or matches nothing useful.
    if (core.replace(/"/g, '').length === 0) {
      continue
    }

    // FTS5 phrase literal: double any embedded quotes.
    const escaped = core.replace(/"/g, '""')
    if (escaped.length === 0) {
      continue
    }

    parts.push(prefix ? `"${escaped}"*` : `"${escaped}"`)
  }

  if (!parts.length) return { ok: true, match: '' }
  return { ok: true, match: parts.join(' ') }
}

/** Throw SearchQueryError when the free-text query is invalid. */
export function requireFtsMatch(userQuery: string): string {
  const built = buildFtsMatch(userQuery)
  if (!built.ok) throw new SearchQueryError(built.reason)
  return built.match
}
