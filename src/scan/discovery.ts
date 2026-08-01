/**
 * eSCL device discovery via mDNS (_uscan._tcp / _uscans._tcp) and manual probe.
 *
 * MdnsLike is injected so tests run a responder + querier with zero real network.
 * USB-only scanners are out of scope — discovery returning [] is honest, not broken.
 */
import { nodeRequire } from '../shared/nodeRequire.ts'
import type { ScanDevice } from '../shared/types.ts'
import { fetchCapabilities } from './capabilities.ts'
import { deviceId, ScanError } from './types.ts'

const PTR_PLAIN = '_uscan._tcp.local'
const PTR_TLS = '_uscans._tcp.local'
const DEFAULT_TIMEOUT_MS = 3000
const DEFAULT_ROOT = 'eSCL'
const DEFAULT_PORT = 80

/** Subset of multicast-dns we depend on — injectable for tests. */
export interface MdnsPacket {
  answers?: MdnsRecord[]
  additionals?: MdnsRecord[]
}

export interface MdnsRecord {
  name: string
  type: string
  data?: unknown
  ttl?: number
}

export interface MdnsLike {
  query(q: { questions: Array<{ name: string; type: string }> }): void
  on(event: 'response', cb: (response: MdnsPacket) => void): void
  on(event: 'error', cb: (err: Error) => void): void
  removeListener?(event: string, cb: (...args: unknown[]) => void): void
  destroy(): void
}

export type MdnsFactory = (opts?: { port?: number; loopback?: boolean; multicast?: boolean }) => MdnsLike

function defaultMdnsFactory(): MdnsFactory {
  // multicast-dns is CJS; nodeRequire works under both ESM tests and CJS bundle.
  const create = nodeRequire('multicast-dns') as MdnsFactory
  return create
}

interface PendingDevice {
  name: string
  host?: string
  port?: number
  root: string
  secure: boolean
  serviceName: string
}

/**
 * Query PTR _uscan._tcp.local (+ _uscans._tcp for TLS listing). Collect SRV/TXT/A
 * until timeout. Dedupe by host:port. TLS devices are listed with secure:true
 * but the client refuses to scan them (tls-unsupported) — do not silently skip.
 */
export async function discoverScanners(opts?: {
  timeoutMs?: number
  mdns?: MdnsLike
  /** Factory used when mdns is not injected. */
  createMdns?: MdnsFactory
}): Promise<ScanDevice[]> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const ownsMdns = !opts?.mdns
  const mdns: MdnsLike =
    opts?.mdns ?? (opts?.createMdns ?? defaultMdnsFactory())()

  const byService = new Map<string, PendingDevice>()
  const aRecords = new Map<string, string>() // hostname.local → ipv4

  const onResponse = (packet: MdnsPacket) => {
    const records = [...(packet.answers ?? []), ...(packet.additionals ?? [])]
    for (const rec of records) {
      const type = String(rec.type).toUpperCase()
      const name = rec.name

      if (type === 'PTR') {
        const target = typeof rec.data === 'string' ? rec.data : ''
        if (!target) continue
        const secure =
          name.toLowerCase().includes('_uscans._tcp') ||
          target.toLowerCase().includes('_uscans._tcp')
        if (!byService.has(target.toLowerCase())) {
          byService.set(target.toLowerCase(), {
            name: humanNameFromService(target),
            root: DEFAULT_ROOT,
            secure,
            serviceName: target,
          })
        } else {
          const existing = byService.get(target.toLowerCase())
          if (existing && secure) existing.secure = true
        }
      } else if (type === 'SRV') {
        const data = rec.data as { port?: number; target?: string } | undefined
        if (!data) continue
        const key = name.toLowerCase()
        let pend = byService.get(key)
        if (!pend) {
          const secure = key.includes('_uscans._tcp')
          pend = {
            name: humanNameFromService(name),
            root: DEFAULT_ROOT,
            secure,
            serviceName: name,
          }
          byService.set(key, pend)
        }
        if (typeof data.port === 'number') pend.port = data.port
        if (typeof data.target === 'string' && data.target) {
          const hostKey = data.target.replace(/\.$/, '').toLowerCase()
          const ip = aRecords.get(hostKey)
          if (ip) pend.host = ip
          else pend.host = data.target.replace(/\.$/, '')
          // stash target for later A resolution
          ;(pend as PendingDevice & { _target?: string })._target = hostKey
        }
      } else if (type === 'TXT') {
        const key = name.toLowerCase()
        let pend = byService.get(key)
        if (!pend) {
          pend = {
            name: humanNameFromService(name),
            root: DEFAULT_ROOT,
            secure: key.includes('_uscans._tcp'),
            serviceName: name,
          }
          byService.set(key, pend)
        }
        const root = parseTxtRs(rec.data)
        if (root) pend.root = root
        const ty = parseTxtKey(rec.data, 'ty')
        if (ty) pend.name = ty
      } else if (type === 'A') {
        const hostKey = name.replace(/\.$/, '').toLowerCase()
        const ip = typeof rec.data === 'string' ? rec.data : String(rec.data ?? '')
        if (ip) {
          aRecords.set(hostKey, ip)
          for (const pend of byService.values()) {
            const target = (pend as PendingDevice & { _target?: string })._target
            if (target === hostKey || pend.host?.toLowerCase() === hostKey) {
              pend.host = ip
            }
          }
        }
      }
    }
  }

  mdns.on('response', onResponse)

  try {
    mdns.query({
      questions: [
        { name: PTR_PLAIN, type: 'PTR' },
        { name: PTR_TLS, type: 'PTR' },
      ],
    })
  } catch {
    // Some mocks throw on query — still wait for injected responses.
  }

  await sleep(timeoutMs)

  try {
    mdns.removeListener?.('response', onResponse as (...args: unknown[]) => void)
  } catch {
    /* ignore */
  }
  if (ownsMdns) {
    try {
      mdns.destroy()
    } catch {
      /* ignore */
    }
  }

  // Build devices; dedupe by host:port.
  const byHostPort = new Map<string, ScanDevice>()
  for (const pend of byService.values()) {
    if (!pend.host || !pend.port) continue
    // Prefer IPv4 over .local hostnames when we have A records.
    const host = pend.host
    const port = pend.port
    const root = pend.root || DEFAULT_ROOT
    const secure = pend.secure
    const key = `${host.toLowerCase()}:${port}`
    const existing = byHostPort.get(key)
    if (existing) {
      // Prefer non-secure entry's name if both; keep secure flag if either is secure.
      if (secure) {
        // Replace only if we don't already have this as secure listing — merge secure.
        existing.secure = existing.secure || secure
      }
      continue
    }
    byHostPort.set(key, {
      id: deviceId(host, port, root, secure),
      name: pend.name,
      host,
      port,
      root,
      secure,
    })
  }

  return [...byHostPort.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Manual-IP path for networks that block mDNS.
 * GET capabilities; return a ScanDevice on success.
 */
export async function probeScanner(
  host: string,
  port: number = DEFAULT_PORT,
  root: string = DEFAULT_ROOT,
  opts?: { signal?: AbortSignal },
): Promise<ScanDevice> {
  const device: ScanDevice = {
    id: deviceId(host, port, root, false),
    name: host,
    host,
    port,
    root: root.replace(/^\/+|\/+$/g, '') || DEFAULT_ROOT,
    secure: false,
  }

  try {
    const caps = await fetchCapabilities(device, { signal: opts?.signal })
    return { ...device, name: caps.makeModel || host }
  } catch (err) {
    if (err instanceof ScanError) throw err
    throw new ScanError(
      'not-reachable',
      `Cannot reach scanner at ${host}:${port}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

function humanNameFromService(serviceName: string): string {
  // "Brother\\ MFC-L3770CDW._uscan._tcp.local" → "Brother MFC-L3770CDW"
  let s = serviceName
  const idx = s.toLowerCase().indexOf('._uscan')
  if (idx < 0) {
    const idx2 = s.toLowerCase().indexOf('._uscans')
    if (idx2 >= 0) s = s.slice(0, idx2)
  } else {
    s = s.slice(0, idx)
  }
  return s.replace(/\\/g, '').replace(/\.$/, '') || serviceName
}

function parseTxtRs(data: unknown): string | undefined {
  return parseTxtKey(data, 'rs')
}

function parseTxtKey(data: unknown, key: string): string | undefined {
  const entries = txtEntries(data)
  for (const e of entries) {
    const eq = e.indexOf('=')
    if (eq <= 0) continue
    const k = e.slice(0, eq).toLowerCase()
    if (k === key.toLowerCase()) {
      const v = e.slice(eq + 1).trim()
      return v || undefined
    }
  }
  return undefined
}

function txtEntries(data: unknown): string[] {
  if (data == null) return []
  if (Buffer.isBuffer(data)) return [data.toString('utf8')]
  if (Array.isArray(data)) {
    return data.map((d) => {
      if (Buffer.isBuffer(d)) return d.toString('utf8')
      if (typeof d === 'string') return d
      return String(d)
    })
  }
  if (typeof data === 'string') return [data]
  if (typeof data === 'object') {
    // Some decoders give { rs: 'eSCL', ty: '...' }
    const obj = data as Record<string, unknown>
    return Object.entries(obj).map(([k, v]) => `${k}=${String(v)}`)
  }
  return []
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
