/**
 * Discovery (injected MdnsLike) + probeScanner tests.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { discoverScanners, probeScanner, type MdnsLike, type MdnsPacket } from '../discovery.ts'
import { ScanError } from '../types.ts'
import { startMockEscl, type MockEsclServer } from './mockServer.ts'

class FakeMdns extends EventEmitter implements MdnsLike {
  queries: Array<{ questions: Array<{ name: string; type: string }> }> = []
  destroyed = false

  query(q: { questions: Array<{ name: string; type: string }> }): void {
    this.queries.push(q)
  }

  destroy(): void {
    this.destroyed = true
  }

  /** Emit a typical eSCL announcement (PTR + SRV + TXT + A). */
  announce(opts: {
    service?: string
    host?: string
    ip?: string
    port?: number
    rs?: string
    ty?: string
    secure?: boolean
  }): void {
    const secure = opts.secure ?? false
    const ptr = secure ? '_uscans._tcp.local' : '_uscan._tcp.local'
    const service =
      opts.service ??
      (secure
        ? 'TLS Scanner._uscans._tcp.local'
        : 'Brother MFC-L3770CDW._uscan._tcp.local')
    const host = opts.host ?? 'scanner.local'
    const ip = opts.ip ?? '192.168.1.42'
    const port = opts.port ?? 80
    const rs = opts.rs ?? 'eSCL'
    const ty = opts.ty ?? 'Brother MFC-L3770CDW'

    const packet: MdnsPacket = {
      answers: [
        { name: ptr, type: 'PTR', data: service },
        {
          name: service,
          type: 'SRV',
          data: { port, target: host, priority: 0, weight: 0 },
        },
        {
          name: service,
          type: 'TXT',
          data: [Buffer.from(`rs=${rs}`), Buffer.from(`ty=${ty}`)],
        },
        { name: host, type: 'A', data: ip },
      ],
    }
    this.emit('response', packet)
  }
}

describe('discoverScanners', () => {
  it('8a. responder announces → device with parsed rs path', async () => {
    const mdns = new FakeMdns()
    // Announce immediately when query fires.
    const origQuery = mdns.query.bind(mdns)
    mdns.query = (q) => {
      origQuery(q)
      queueMicrotask(() =>
        mdns.announce({
          ip: '10.0.0.5',
          port: 8080,
          rs: 'eSCL',
          ty: 'Brother MFC-L3770CDW',
        }),
      )
    }

    const devices = await discoverScanners({ timeoutMs: 80, mdns })
    assert.equal(devices.length, 1)
    const d = devices[0]!
    assert.equal(d.host, '10.0.0.5')
    assert.equal(d.port, 8080)
    assert.equal(d.root, 'eSCL')
    assert.equal(d.secure, false)
    assert.equal(d.name, 'Brother MFC-L3770CDW')
    assert.ok(d.id.includes('10.0.0.5:8080'))
    // Injected mdns is not owned — must not destroy the caller's instance.
    assert.equal(mdns.destroyed, false)
  })

  it('8b. timeout with no responder → []', async () => {
    const mdns = new FakeMdns()
    const devices = await discoverScanners({ timeoutMs: 40, mdns })
    assert.deepEqual(devices, [])
  })

  it('TLS _uscans responders listed with secure:true (not silently skipped)', async () => {
    const mdns = new FakeMdns()
    mdns.query = (q) => {
      mdns.queries.push(q)
      queueMicrotask(() =>
        mdns.announce({
          secure: true,
          ip: '10.0.0.9',
          port: 443,
          ty: 'Secure Scanner',
        }),
      )
    }
    const devices = await discoverScanners({ timeoutMs: 60, mdns })
    assert.equal(devices.length, 1)
    assert.equal(devices[0]!.secure, true)
    assert.ok(devices[0]!.id.startsWith('https://'))
  })

  it('dedupes by host:port', async () => {
    const mdns = new FakeMdns()
    mdns.query = () => {
      queueMicrotask(() => {
        mdns.announce({
          service: 'A._uscan._tcp.local',
          ip: '1.2.3.4',
          port: 80,
          ty: 'First',
        })
        mdns.announce({
          service: 'B._uscan._tcp.local',
          ip: '1.2.3.4',
          port: 80,
          ty: 'Second',
        })
      })
    }
    const devices = await discoverScanners({ timeoutMs: 60, mdns })
    assert.equal(devices.length, 1)
  })
})

describe('probeScanner', () => {
  let server: MockEsclServer

  before(async () => {
    server = await startMockEscl({ caps: 'brother' })
  })
  after(async () => {
    await server.close()
  })

  it('9a. probe against mock → ScanDevice with makeModel name', async () => {
    const device = await probeScanner(server.host, server.port, server.root)
    assert.equal(device.host, server.host)
    assert.equal(device.port, server.port)
    assert.equal(device.root, server.root)
    assert.equal(device.secure, false)
    assert.equal(device.name, 'Brother MFC-L3770CDW')
  })

  it('9b. probe against closed port → not-reachable', async () => {
    // Bind-and-close to pick a free port that is not listening.
    const closed = await startMockEscl()
    const port = closed.port
    await closed.close()
    await assert.rejects(
      () => probeScanner('127.0.0.1', port, 'eSCL'),
      (err: unknown) => {
        assert.ok(err instanceof ScanError)
        assert.equal(err.code, 'not-reachable')
        return true
      },
    )
  })
})
