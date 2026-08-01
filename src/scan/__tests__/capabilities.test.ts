/**
 * Capabilities parse + fetch tests.
 * Run: node --experimental-strip-types --test src/scan/__tests__/capabilities.test.ts
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCapabilities,
  parseCapabilitiesXml,
  fetchCapabilities,
} from '../capabilities.ts'
import { ScanError } from '../types.ts'
import type { ScanDevice } from '../../shared/types.ts'
import {
  EXPECTED_NORMALIZED_CAPS,
  FIXTURE_BROTHER_SCAN_PREFIX,
  FIXTURE_HP_PWG_PREFIX,
  FIXTURE_PDF_ONLY_ADF,
} from './fixtures.ts'
import { startMockEscl, type MockEsclServer } from './mockServer.ts'

describe('capabilities', () => {
  it('2. scan:-prefixed and pwg:-prefixed fixtures → identical ScanCaps', () => {
    const brother = parseCapabilities(FIXTURE_BROTHER_SCAN_PREFIX)
    const hp = parseCapabilities(FIXTURE_HP_PWG_PREFIX)
    assert.deepEqual(brother, EXPECTED_NORMALIZED_CAPS)
    assert.deepEqual(hp, EXPECTED_NORMALIZED_CAPS)
    assert.deepEqual(brother, hp)
  })

  it('PDF-only ADF device → typed protocol error mentioning format', () => {
    assert.throws(
      () => parseCapabilities(FIXTURE_PDF_ONLY_ADF),
      (err: unknown) => {
        assert.ok(err instanceof ScanError)
        assert.equal(err.code, 'protocol')
        assert.match(err.message, /format|jpeg|pdf/i)
        return true
      },
    )
    // parseCapabilitiesXml still returns caps+formats for diagnostics
    const raw = parseCapabilitiesXml(FIXTURE_PDF_ONLY_ADF)
    assert.ok(raw.documentFormats.includes('application/pdf'))
    assert.ok(!raw.documentFormats.some((f) => f.includes('jpeg')))
  })

  it('processEntities is disabled (entity expansion does not inject content)', () => {
    // If entities were expanded, &xxe; would attempt external load or expand.
    // With processEntities:false the entity ref is left alone / dropped safely.
    const xml = `<?xml version="1.0"?>
      <!DOCTYPE foo [<!ENTITY xxe "EVIL">]>
      <ScannerCapabilities>
        <MakeAndModel>&xxe;</MakeAndModel>
        <Platen><PlatenInputCaps>
          <SettingProfiles><SettingProfile>
            <ColorModes><ColorMode>RGB24</ColorMode></ColorModes>
            <DocumentFormats><DocumentFormat>image/jpeg</DocumentFormat></DocumentFormats>
            <SupportedResolutions><DiscreteResolutions>
              <DiscreteResolution><XResolution>300</XResolution><YResolution>300</YResolution></DiscreteResolution>
            </DiscreteResolutions></SupportedResolutions>
          </SettingProfile></SettingProfiles>
        </PlatenInputCaps></Platen>
      </ScannerCapabilities>`
    // Must not throw / crash; must not expand to EVIL as makeModel.
    try {
      const caps = parseCapabilities(xml)
      assert.notEqual(caps.makeModel, 'EVIL')
    } catch (err) {
      // Also acceptable: parse rejects DOCTYPE / incomplete caps.
      assert.ok(err instanceof ScanError)
    }
  })
})

describe('fetchCapabilities against mock', () => {
  let server: MockEsclServer
  let authServer: MockEsclServer
  let pdfServer: MockEsclServer

  before(async () => {
    server = await startMockEscl({ caps: 'brother' })
    authServer = await startMockEscl({ requireAuth: true })
    pdfServer = await startMockEscl({ caps: 'pdf-only' })
  })

  after(async () => {
    await server.close()
    await authServer.close()
    await pdfServer.close()
  })

  function deviceFor(s: MockEsclServer): ScanDevice {
    return {
      id: `http://${s.host}:${s.port}/${s.root}`,
      name: 'mock',
      host: s.host,
      port: s.port,
      root: s.root,
      secure: false,
    }
  }

  it('fetchCapabilities returns normalized caps from mock', async () => {
    const caps = await fetchCapabilities(deviceFor(server))
    assert.deepEqual(caps, EXPECTED_NORMALIZED_CAPS)
  })

  it('auth-required device → not-reachable with auth message', async () => {
    await assert.rejects(
      () => fetchCapabilities(deviceFor(authServer)),
      (err: unknown) => {
        assert.ok(err instanceof ScanError)
        assert.equal(err.code, 'not-reachable')
        assert.match(err.message, /auth/i)
        return true
      },
    )
  })

  it('PDF-only mock → protocol error on fetch', async () => {
    await assert.rejects(
      () => fetchCapabilities(deviceFor(pdfServer)),
      (err: unknown) => {
        assert.ok(err instanceof ScanError)
        assert.equal(err.code, 'protocol')
        assert.match(err.message, /jpeg|format/i)
        return true
      },
    )
  })

  it('secure device refused with tls-unsupported without network', async () => {
    await assert.rejects(
      () =>
        fetchCapabilities({
          id: 'https://x:443/eSCL',
          name: 'TLS Scanner',
          host: 'x',
          port: 443,
          root: 'eSCL',
          secure: true,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ScanError)
        assert.equal(err.code, 'tls-unsupported')
        return true
      },
    )
  })
})
