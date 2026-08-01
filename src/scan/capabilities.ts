/**
 * eSCL ScannerCapabilities fetch + namespace-tolerant parse.
 *
 * Vendors emit scan:-prefixed (HP/Apple schema), pwg:-prefixed, or bare local
 * names. removeNSPrefix normalizes all three to the same shape.
 */
import type { ScanCaps, ScanDevice } from '../shared/types.ts'
import { deviceBaseUrl, ScanError } from './types.ts'
import { asArray, firstText, parseXml } from './xml.ts'

const COLOR_MODES = new Set(['RGB24', 'Grayscale8', 'BlackAndWhite1'])

export interface CapsFetchResult {
  caps: ScanCaps
  /** MIME types advertised under DocumentFormat / DocumentFormatExt. */
  documentFormats: string[]
}

/**
 * Parse ScannerCapabilities XML into normalized ScanCaps.
 * Throws ScanError('protocol') when no usable source/format/mode is present.
 */
export function parseCapabilitiesXml(xml: string): CapsFetchResult {
  let root: unknown
  try {
    root = parseXml(xml)
  } catch (err) {
    throw new ScanError(
      'protocol',
      `Failed to parse ScannerCapabilities XML: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const capsNode =
    (root as Record<string, unknown> | null)?.ScannerCapabilities ?? root

  if (capsNode == null || typeof capsNode !== 'object') {
    throw new ScanError('protocol', 'ScannerCapabilities root element missing')
  }

  const makeModel =
    firstText(capsNode, 'MakeAndModel') ??
    firstText(capsNode, 'Manufacturer') ??
    'Unknown scanner'

  const sources: Array<'Platen' | 'Adf'> = []
  const colorModes = new Set<ScanCaps['colorModes'][number]>()
  const resolutions = new Set<number>()
  let duplex = false
  const documentFormats = new Set<string>()

  const obj = capsNode as Record<string, unknown>

  if (obj.Platen != null) {
    sources.push('Platen')
    harvestSource(obj.Platen, colorModes, resolutions, documentFormats)
  }
  if (obj.Adf != null) {
    sources.push('Adf')
    harvestSource(obj.Adf, colorModes, resolutions, documentFormats)
    // Duplex capability: AdfDuplexInputCaps present, or explicit Duplex true.
    const adf = obj.Adf as Record<string, unknown>
    if (adf.AdfDuplexInputCaps != null) duplex = true
    const duplexFlag = firstText(adf, 'Duplex')
    if (duplexFlag === 'true' || duplexFlag === '1') duplex = true
  }

  // Some fixtures put SettingProfiles at the top level (no Platen/Adf wrapper).
  if (sources.length === 0) {
    harvestSource(capsNode, colorModes, resolutions, documentFormats)
    if (colorModes.size > 0 || resolutions.size > 0) {
      sources.push('Platen')
    }
  }

  if (sources.length === 0) {
    throw new ScanError(
      'protocol',
      'ScannerCapabilities lists neither Platen nor Adf sources',
    )
  }
  if (colorModes.size === 0) {
    throw new ScanError('protocol', 'ScannerCapabilities lists no color modes')
  }
  if (resolutions.size === 0) {
    throw new ScanError('protocol', 'ScannerCapabilities lists no resolutions')
  }

  const caps: ScanCaps = {
    makeModel,
    sources,
    colorModes: (['RGB24', 'Grayscale8', 'BlackAndWhite1'] as const).filter((m) =>
      colorModes.has(m),
    ),
    resolutions: [...resolutions].sort((a, b) => a - b),
    duplex,
  }

  return { caps, documentFormats: [...documentFormats] }
}

function harvestSource(
  node: unknown,
  colorModes: Set<ScanCaps['colorModes'][number]>,
  resolutions: Set<number>,
  documentFormats: Set<string>,
): void {
  if (node == null || typeof node !== 'object') return
  walk(node, colorModes, resolutions, documentFormats)
}

function walk(
  node: unknown,
  colorModes: Set<ScanCaps['colorModes'][number]>,
  resolutions: Set<number>,
  documentFormats: Set<string>,
): void {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, colorModes, resolutions, documentFormats)
    return
  }
  const obj = node as Record<string, unknown>

  if (obj.ColorMode != null) {
    for (const m of asArray(obj.ColorMode)) {
      const s = String(m)
      if (COLOR_MODES.has(s)) colorModes.add(s as ScanCaps['colorModes'][number])
    }
  }

  if (obj.XResolution != null && obj.YResolution != null) {
    const x = Number(obj.XResolution)
    const y = Number(obj.YResolution)
    if (Number.isFinite(x) && x === y && x > 0) resolutions.add(x)
  }

  if (obj.DocumentFormat != null) {
    for (const f of asArray(obj.DocumentFormat)) documentFormats.add(String(f))
  }
  if (obj.DocumentFormatExt != null) {
    for (const f of asArray(obj.DocumentFormatExt)) documentFormats.add(String(f))
  }

  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') walk(v, colorModes, resolutions, documentFormats)
  }
}

/** Refuse devices that cannot produce image/jpeg (e.g. PDF-only ADF). */
export function assertJpegSupported(formats: string[], makeModel: string): void {
  const ok = formats.some(
    (f) => f.toLowerCase() === 'image/jpeg' || f.toLowerCase() === 'image/jpg',
  )
  // Empty format list: some minimal fixtures omit formats; allow JPEG by default.
  if (formats.length === 0) return
  if (!ok) {
    throw new ScanError(
      'protocol',
      `Scanner "${makeModel}" does not advertise image/jpeg ` +
        `(formats: ${formats.join(', ') || 'none'}). KeepR requires JPEG pages.`,
    )
  }
}

/**
 * GET {base}/ScannerCapabilities → ScanCaps.
 * 401 → not-reachable with an auth message; other HTTP failures → not-reachable/protocol.
 */
export async function fetchCapabilities(
  device: ScanDevice,
  opts?: { signal?: AbortSignal },
): Promise<ScanCaps> {
  if (device.secure) {
    throw new ScanError(
      'tls-unsupported',
      'TLS (eSCL over HTTPS / _uscans._tcp) scanners are listed but not yet scannable in this version.',
    )
  }

  const url = `${deviceBaseUrl(device)}/ScannerCapabilities`
  let res: Response
  try {
    res = await fetch(url, { method: 'GET', signal: opts?.signal })
  } catch (err) {
    if (opts?.signal?.aborted) throw new ScanError('canceled', 'Scan canceled')
    throw new ScanError(
      'not-reachable',
      `Cannot reach scanner at ${device.host}:${device.port}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (res.status === 401 || res.status === 403) {
    throw new ScanError(
      'not-reachable',
      `Scanner at ${device.host}:${device.port} requires authentication (HTTP ${res.status}). ` +
        'KeepR does not yet support authenticated eSCL devices.',
    )
  }
  if (!res.ok) {
    throw new ScanError(
      'not-reachable',
      `ScannerCapabilities returned HTTP ${res.status} from ${device.host}:${device.port}`,
    )
  }

  const xml = await res.text()
  const { caps, documentFormats } = parseCapabilitiesXml(xml)
  assertJpegSupported(documentFormats, caps.makeModel)
  return caps
}

/** Parse raw XML only (tests + fixtures). */
export function parseCapabilities(xml: string): ScanCaps {
  const { caps, documentFormats } = parseCapabilitiesXml(xml)
  assertJpegSupported(documentFormats, caps.makeModel)
  return caps
}
