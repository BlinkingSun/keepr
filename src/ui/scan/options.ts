/**
 * Pure option derivation from ScanCaps — never offer what the device omitted.
 */
import type { ScanCaps, ScanOptions } from '../../shared/types.ts'

export type ColorLabel = 'Color' | 'Grayscale' | 'Black & white'

const COLOR_LABELS: Record<ScanOptions['colorMode'], ColorLabel> = {
  RGB24: 'Color',
  Grayscale8: 'Grayscale',
  BlackAndWhite1: 'Black & white',
}

const COLOR_FROM_LABEL: Record<ColorLabel, ScanOptions['colorMode']> = {
  Color: 'RGB24',
  Grayscale: 'Grayscale8',
  'Black & white': 'BlackAndWhite1',
}

export function colorModeLabel(mode: ScanOptions['colorMode']): ColorLabel {
  return COLOR_LABELS[mode]
}

export function colorModeFromLabel(label: ColorLabel): ScanOptions['colorMode'] {
  return COLOR_FROM_LABEL[label]
}

/** Source choices the device actually advertised. */
export function availableSources(caps: ScanCaps | null): Array<'Platen' | 'Adf'> {
  if (!caps) return []
  return [...caps.sources]
}

export function availableColorModes(
  caps: ScanCaps | null,
): Array<ScanOptions['colorMode']> {
  if (!caps) return []
  return [...caps.colorModes]
}

export function availableResolutions(caps: ScanCaps | null): number[] {
  if (!caps) return []
  return [...caps.resolutions]
}

export function duplexAvailable(caps: ScanCaps | null): boolean {
  return caps?.duplex === true && (caps.sources.includes('Adf') ?? false)
}

/**
 * Default ScanOptions from caps. Prefers Adf when present, 300 dpi when
 * available, otherwise the highest advertised resolution, RGB24 when present.
 */
export function defaultOptions(caps: ScanCaps | null): ScanOptions | null {
  if (!caps || caps.sources.length === 0) return null
  const source: 'Platen' | 'Adf' = caps.sources.includes('Adf')
    ? 'Adf'
    : (caps.sources[0] as 'Platen' | 'Adf')
  const colorMode: ScanOptions['colorMode'] = caps.colorModes.includes('RGB24')
    ? 'RGB24'
    : (caps.colorModes[0] ?? 'RGB24')
  const dpi = caps.resolutions.includes(300)
    ? 300
    : (caps.resolutions[caps.resolutions.length - 1] ?? 300)
  const opts: ScanOptions = { source, colorMode, dpi }
  if (duplexAvailable(caps) && source === 'Adf') {
    opts.duplex = false
  }
  return opts
}

/**
 * Clamp a partial options patch to what caps allow. Returns null if caps empty.
 */
export function clampOptions(
  caps: ScanCaps | null,
  current: ScanOptions | null,
  patch: Partial<ScanOptions>,
): ScanOptions | null {
  const base = current ?? defaultOptions(caps)
  if (!base || !caps) return null
  const next: ScanOptions = { ...base, ...patch }

  if (!caps.sources.includes(next.source)) {
    next.source = caps.sources[0] as 'Platen' | 'Adf'
  }
  if (!caps.colorModes.includes(next.colorMode)) {
    next.colorMode = caps.colorModes[0] ?? 'RGB24'
  }
  if (!caps.resolutions.includes(next.dpi)) {
    next.dpi = caps.resolutions.includes(300)
      ? 300
      : (caps.resolutions[caps.resolutions.length - 1] ?? next.dpi)
  }
  if (next.source !== 'Adf' || !caps.duplex) {
    delete next.duplex
  } else if (patch.duplex !== undefined) {
    next.duplex = patch.duplex
  }

  return next
}

export function sourceLabel(source: 'Platen' | 'Adf'): string {
  return source === 'Adf' ? 'ADF' : 'Platen'
}
