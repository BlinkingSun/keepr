/**
 * Lane S — eSCL (AirScan) types and typed errors.
 *
 * eSCL is the driverless scan protocol behind Apple AirScan/Mopria — effectively
 * every network-capable scanner and MFP of the last decade speaks it over HTTP.
 * Pure JS, no drivers. USB-ONLY scanners need native ImageCaptureCore/TWAIN work
 * and are explicitly OUT of this lane.
 */
import type {
  ScanCaps,
  ScanDevice,
  ScanErrorCode,
  ScanOptions,
} from '../shared/types.ts'

export type { ScanCaps, ScanDevice, ScanErrorCode, ScanOptions }

/** Typed failure from every scan-path operation. */
export class ScanError extends Error {
  readonly code: ScanErrorCode

  constructor(code: ScanErrorCode, message: string) {
    super(message)
    this.name = 'ScanError'
    this.code = code
  }
}

export function isScanError(err: unknown): err is ScanError {
  return err instanceof ScanError
}

/** Minimal injectable clock for deterministic filenames in tests. */
export type Clock = () => Date

export function formatScanBaseName(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `Scan ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`
  )
}

/** Device id is stable across discovery and probe: scheme://host:port/root. */
export function deviceId(host: string, port: number, root: string, secure: boolean): string {
  const scheme = secure ? 'https' : 'http'
  const r = root.replace(/^\/+|\/+$/g, '') || 'eSCL'
  return `${scheme}://${host}:${port}/${r}`
}

export function deviceBaseUrl(device: ScanDevice): string {
  const scheme = device.secure ? 'https' : 'http'
  const root = device.root.replace(/^\/+|\/+$/g, '') || 'eSCL'
  return `${scheme}://${device.host}:${device.port}/${root}`
}
