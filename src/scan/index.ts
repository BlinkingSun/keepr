/**
 * Lane S — eSCL (AirScan) network scanning.
 *
 * eSCL is the driverless protocol behind Apple AirScan/Mopria. Pure JS over
 * HTTP; no native drivers. USB-only scanners are out of scope for this batch.
 */
export { ScanError, isScanError, formatScanBaseName, deviceId, deviceBaseUrl } from './types.ts'
export type { Clock } from './types.ts'

export {
  parseCapabilities,
  parseCapabilitiesXml,
  fetchCapabilities,
  assertJpegSupported,
} from './capabilities.ts'
export type { CapsFetchResult } from './capabilities.ts'

export { discoverScanners, probeScanner } from './discovery.ts'
export type { MdnsLike, MdnsFactory, MdnsPacket, MdnsRecord } from './discovery.ts'

export {
  createScanJob,
  runScanJob,
  buildScanSettingsXml,
  RETRY_BUDGET_MS,
  sleepWithAbort,
} from './job.ts'
export type { PageCallback, ScanJobHandle, CreateJobOpts } from './job.ts'

export {
  scanToFiles,
  scanAndIngest,
  scanJobDetail,
} from './scanner.ts'
export type {
  ScanToFilesIo,
  ScanAndIngestDeps,
  ScanAndIngestIo,
  ScanAndIngestResult,
  ImportPagesAsItem,
  ScanEventEmitter,
} from './scanner.ts'
