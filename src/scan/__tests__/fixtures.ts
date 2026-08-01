/**
 * Vendor capability / status XML fixtures for namespace-tolerant parsing tests.
 *
 * Modeled after:
 *   - Brother MFC-L3770CDW style: scan: prefix (HP eSCL schema URIs)
 *   - HP OfficeJet / PWG style: pwg: + scan: mixed, DocumentFormat under pwg
 *   - PDF-only ADF device (must refuse with protocol/format error)
 *   - ScannerStatus AdfEmpty (Canon/EPSON encoding)
 */

/** Brother-like: scan:-prefixed elements throughout. */
export const FIXTURE_BROTHER_SCAN_PREFIX = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScannerCapabilities
  xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03"
  xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.6</pwg:Version>
  <pwg:MakeAndModel>Brother MFC-L3770CDW</pwg:MakeAndModel>
  <scan:Manufacturer>Brother</scan:Manufacturer>
  <scan:Platen>
    <scan:PlatenInputCaps>
      <scan:MinWidth>300</scan:MinWidth>
      <scan:MaxWidth>2550</scan:MaxWidth>
      <scan:MinHeight>300</scan:MinHeight>
      <scan:MaxHeight>3508</scan:MaxHeight>
      <scan:SettingProfiles>
        <scan:SettingProfile>
          <scan:ColorModes>
            <scan:ColorMode>RGB24</scan:ColorMode>
            <scan:ColorMode>Grayscale8</scan:ColorMode>
            <scan:ColorMode>BlackAndWhite1</scan:ColorMode>
          </scan:ColorModes>
          <scan:DocumentFormats>
            <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
            <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
          </scan:DocumentFormats>
          <scan:SupportedResolutions>
            <scan:DiscreteResolutions>
              <scan:DiscreteResolution>
                <scan:XResolution>100</scan:XResolution>
                <scan:YResolution>100</scan:YResolution>
              </scan:DiscreteResolution>
              <scan:DiscreteResolution>
                <scan:XResolution>200</scan:XResolution>
                <scan:YResolution>200</scan:YResolution>
              </scan:DiscreteResolution>
              <scan:DiscreteResolution>
                <scan:XResolution>300</scan:XResolution>
                <scan:YResolution>300</scan:YResolution>
              </scan:DiscreteResolution>
            </scan:DiscreteResolutions>
          </scan:SupportedResolutions>
        </scan:SettingProfile>
      </scan:SettingProfiles>
    </scan:PlatenInputCaps>
  </scan:Platen>
  <scan:Adf>
    <scan:AdfSimplexInputCaps>
      <scan:MinWidth>300</scan:MinWidth>
      <scan:MaxWidth>2550</scan:MaxWidth>
      <scan:MinHeight>300</scan:MinHeight>
      <scan:MaxHeight>4200</scan:MaxHeight>
      <scan:SettingProfiles>
        <scan:SettingProfile>
          <scan:ColorModes>
            <scan:ColorMode>RGB24</scan:ColorMode>
            <scan:ColorMode>Grayscale8</scan:ColorMode>
            <scan:ColorMode>BlackAndWhite1</scan:ColorMode>
          </scan:ColorModes>
          <scan:DocumentFormats>
            <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
            <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
          </scan:DocumentFormats>
          <scan:SupportedResolutions>
            <scan:DiscreteResolutions>
              <scan:DiscreteResolution>
                <scan:XResolution>100</scan:XResolution>
                <scan:YResolution>100</scan:YResolution>
              </scan:DiscreteResolution>
              <scan:DiscreteResolution>
                <scan:XResolution>200</scan:XResolution>
                <scan:YResolution>200</scan:YResolution>
              </scan:DiscreteResolution>
              <scan:DiscreteResolution>
                <scan:XResolution>300</scan:XResolution>
                <scan:YResolution>300</scan:YResolution>
              </scan:DiscreteResolution>
            </scan:DiscreteResolutions>
          </scan:SupportedResolutions>
        </scan:SettingProfile>
      </scan:SettingProfiles>
    </scan:AdfSimplexInputCaps>
    <scan:AdfDuplexInputCaps>
      <scan:MinWidth>300</scan:MinWidth>
      <scan:MaxWidth>2550</scan:MaxWidth>
      <scan:MinHeight>300</scan:MinHeight>
      <scan:MaxHeight>4200</scan:MaxHeight>
      <scan:SettingProfiles>
        <scan:SettingProfile>
          <scan:ColorModes>
            <scan:ColorMode>RGB24</scan:ColorMode>
            <scan:ColorMode>Grayscale8</scan:ColorMode>
          </scan:ColorModes>
          <scan:DocumentFormats>
            <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
          </scan:DocumentFormats>
          <scan:SupportedResolutions>
            <scan:DiscreteResolutions>
              <scan:DiscreteResolution>
                <scan:XResolution>200</scan:XResolution>
                <scan:YResolution>200</scan:YResolution>
              </scan:DiscreteResolution>
              <scan:DiscreteResolution>
                <scan:XResolution>300</scan:XResolution>
                <scan:YResolution>300</scan:YResolution>
              </scan:DiscreteResolution>
            </scan:DiscreteResolutions>
          </scan:SupportedResolutions>
        </scan:SettingProfile>
      </scan:SettingProfiles>
    </scan:AdfDuplexInputCaps>
  </scan:Adf>
</scan:ScannerCapabilities>`

/**
 * HP/PWG-like: heavier pwg: usage; same logical capabilities as Brother fixture
 * so parseCapabilities normalizes both to identical ScanCaps.
 */
export const FIXTURE_HP_PWG_PREFIX = `<?xml version="1.0" encoding="UTF-8"?>
<pwg:ScannerCapabilities
  xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm"
  xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03">
  <pwg:Version>2.6</pwg:Version>
  <pwg:MakeAndModel>Brother MFC-L3770CDW</pwg:MakeAndModel>
  <scan:Manufacturer>Brother</scan:Manufacturer>
  <pwg:Platen>
    <pwg:PlatenInputCaps>
      <pwg:MinWidth>300</pwg:MinWidth>
      <pwg:MaxWidth>2550</pwg:MaxWidth>
      <pwg:MinHeight>300</pwg:MinHeight>
      <pwg:MaxHeight>3508</pwg:MaxHeight>
      <scan:SettingProfiles>
        <scan:SettingProfile>
          <scan:ColorModes>
            <scan:ColorMode>RGB24</scan:ColorMode>
            <scan:ColorMode>Grayscale8</scan:ColorMode>
            <scan:ColorMode>BlackAndWhite1</scan:ColorMode>
          </scan:ColorModes>
          <scan:DocumentFormats>
            <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
            <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
          </scan:DocumentFormats>
          <scan:SupportedResolutions>
            <scan:DiscreteResolutions>
              <scan:DiscreteResolution>
                <scan:XResolution>100</scan:XResolution>
                <scan:YResolution>100</scan:YResolution>
              </scan:DiscreteResolution>
              <scan:DiscreteResolution>
                <scan:XResolution>200</scan:XResolution>
                <scan:YResolution>200</scan:YResolution>
              </scan:DiscreteResolution>
              <scan:DiscreteResolution>
                <scan:XResolution>300</scan:XResolution>
                <scan:YResolution>300</scan:YResolution>
              </scan:DiscreteResolution>
            </scan:DiscreteResolutions>
          </scan:SupportedResolutions>
        </scan:SettingProfile>
      </scan:SettingProfiles>
    </pwg:PlatenInputCaps>
  </pwg:Platen>
  <pwg:Adf>
    <pwg:AdfSimplexInputCaps>
      <pwg:MinWidth>300</pwg:MinWidth>
      <pwg:MaxWidth>2550</pwg:MaxWidth>
      <pwg:MinHeight>300</pwg:MinHeight>
      <pwg:MaxHeight>4200</pwg:MaxHeight>
      <scan:SettingProfiles>
        <scan:SettingProfile>
          <scan:ColorModes>
            <scan:ColorMode>RGB24</scan:ColorMode>
            <scan:ColorMode>Grayscale8</scan:ColorMode>
            <scan:ColorMode>BlackAndWhite1</scan:ColorMode>
          </scan:ColorModes>
          <scan:DocumentFormats>
            <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
            <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
          </scan:DocumentFormats>
          <scan:SupportedResolutions>
            <scan:DiscreteResolutions>
              <scan:DiscreteResolution>
                <scan:XResolution>100</scan:XResolution>
                <scan:YResolution>100</scan:YResolution>
              </scan:DiscreteResolution>
              <scan:DiscreteResolution>
                <scan:XResolution>200</scan:XResolution>
                <scan:YResolution>200</scan:YResolution>
              </scan:DiscreteResolution>
              <scan:DiscreteResolution>
                <scan:XResolution>300</scan:XResolution>
                <scan:YResolution>300</scan:YResolution>
              </scan:DiscreteResolution>
            </scan:DiscreteResolutions>
          </scan:SupportedResolutions>
        </scan:SettingProfile>
      </scan:SettingProfiles>
    </pwg:AdfSimplexInputCaps>
    <pwg:AdfDuplexInputCaps>
      <pwg:MinWidth>300</pwg:MinWidth>
      <pwg:MaxWidth>2550</pwg:MaxWidth>
      <pwg:MinHeight>300</pwg:MinHeight>
      <pwg:MaxHeight>4200</pwg:MaxHeight>
      <scan:SettingProfiles>
        <scan:SettingProfile>
          <scan:ColorModes>
            <scan:ColorMode>RGB24</scan:ColorMode>
            <scan:ColorMode>Grayscale8</scan:ColorMode>
          </scan:ColorModes>
          <scan:DocumentFormats>
            <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
          </scan:DocumentFormats>
          <scan:SupportedResolutions>
            <scan:DiscreteResolutions>
              <scan:DiscreteResolution>
                <scan:XResolution>200</scan:XResolution>
                <scan:YResolution>200</scan:YResolution>
              </scan:DiscreteResolution>
              <scan:DiscreteResolution>
                <scan:XResolution>300</scan:XResolution>
                <scan:YResolution>300</scan:YResolution>
              </scan:DiscreteResolution>
            </scan:DiscreteResolutions>
          </scan:SupportedResolutions>
        </scan:SettingProfile>
      </scan:SettingProfiles>
    </pwg:AdfDuplexInputCaps>
  </pwg:Adf>
</pwg:ScannerCapabilities>`

/** ADF-only device that only advertises application/pdf — must refuse. */
export const FIXTURE_PDF_ONLY_ADF = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScannerCapabilities
  xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03"
  xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:MakeAndModel>PDF-Only ADF Scanner</pwg:MakeAndModel>
  <scan:Adf>
    <scan:AdfSimplexInputCaps>
      <scan:MaxWidth>2550</scan:MaxWidth>
      <scan:MaxHeight>4200</scan:MaxHeight>
      <scan:SettingProfiles>
        <scan:SettingProfile>
          <scan:ColorModes>
            <scan:ColorMode>RGB24</scan:ColorMode>
          </scan:ColorModes>
          <scan:DocumentFormats>
            <pwg:DocumentFormat>application/pdf</pwg:DocumentFormat>
            <scan:DocumentFormatExt>application/pdf</scan:DocumentFormatExt>
          </scan:DocumentFormats>
          <scan:SupportedResolutions>
            <scan:DiscreteResolutions>
              <scan:DiscreteResolution>
                <scan:XResolution>300</scan:XResolution>
                <scan:YResolution>300</scan:YResolution>
              </scan:DiscreteResolution>
            </scan:DiscreteResolutions>
          </scan:SupportedResolutions>
        </scan:SettingProfile>
      </scan:SettingProfiles>
    </scan:AdfSimplexInputCaps>
  </scan:Adf>
</scan:ScannerCapabilities>`

/** ScannerStatus with AdfEmpty (Canon TR4500 / EPSON XP-7100 encoding). */
export const FIXTURE_STATUS_ADF_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScannerStatus
  xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03"
  xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.6</pwg:Version>
  <pwg:State>Idle</pwg:State>
  <scan:AdfState>ScannerAdfEmpty</scan:AdfState>
</scan:ScannerStatus>`

export const FIXTURE_STATUS_ADF_LOADED = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScannerStatus
  xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03"
  xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.6</pwg:Version>
  <pwg:State>Idle</pwg:State>
  <scan:AdfState>ScannerAdfLoaded</scan:AdfState>
</scan:ScannerStatus>`

/** Minimal valid JPEG (1x1 pixel) — real SOI/EOI markers for content-type checks. */
export const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
  0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
  0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
  0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
  0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d,
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
  0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
  0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
  0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
  0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
  0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
  0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01,
  0x00, 0x00, 0x3f, 0x00, 0x7f, 0xff, 0xd9,
])

export const EXPECTED_NORMALIZED_CAPS = {
  makeModel: 'Brother MFC-L3770CDW',
  sources: ['Platen', 'Adf'] as Array<'Platen' | 'Adf'>,
  colorModes: ['RGB24', 'Grayscale8', 'BlackAndWhite1'] as Array<
    'RGB24' | 'Grayscale8' | 'BlackAndWhite1'
  >,
  resolutions: [100, 200, 300],
  duplex: true,
}
