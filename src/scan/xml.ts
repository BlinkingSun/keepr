/**
 * Safe XML parsing for untrusted scanner responses.
 * processEntities:false — no external entity expansion (XXE).
 */
import { nodeRequire } from '../shared/nodeRequire.ts'

interface XmlParserCtor {
  new (opts: {
    processEntities: boolean
    ignoreAttributes: boolean
    removeNSPrefix: boolean
    trimValues: boolean
    isArray?: (tagName: string) => boolean
  }): { parse(xml: string): unknown }
}

const { XMLParser } = nodeRequire('fast-xml-parser') as { XMLParser: XmlParserCtor }

/** Tags that vendors may repeat as either a single object or an array. */
const ARRAY_TAGS = new Set([
  'ColorMode',
  'DiscreteResolution',
  'SettingProfile',
  'DocumentFormat',
  'DocumentFormatExt',
  'SupportedIntent',
  'Intent',
])

let cached: InstanceType<XmlParserCtor> | null = null

function parser(): InstanceType<XmlParserCtor> {
  if (!cached) {
    cached = new XMLParser({
      // Scanner XML is untrusted input — never expand entities.
      processEntities: false,
      ignoreAttributes: false,
      removeNSPrefix: true,
      trimValues: true,
      isArray: (tagName: string) => ARRAY_TAGS.has(tagName),
    })
  }
  return cached
}

export function parseXml(xml: string): unknown {
  return parser().parse(xml)
}

/** Walk an object tree; collect string values of every node named `tag`. */
export function collectText(node: unknown, tag: string, out: string[] = []): string[] {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, tag, out)
    return out
  }
  const obj = node as Record<string, unknown>
  for (const [k, v] of Object.entries(obj)) {
    if (k === tag) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out.push(String(v))
      } else if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === 'string' || typeof item === 'number') out.push(String(item))
          else collectText(item, tag, out)
        }
      } else if (v && typeof v === 'object') {
        collectText(v, tag, out)
      }
    } else {
      collectText(v, tag, out)
    }
  }
  return out
}

/** First string value of a named tag under node, or undefined. */
export function firstText(node: unknown, tag: string): string | undefined {
  const found = collectText(node, tag)
  return found[0]
}

/** Coerce a possibly-single/array XML child to an array. */
export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}
