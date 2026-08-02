/**
 * ScanPanel — presentational modal over props.
 *
 * Discovers eSCL (AirScan) network scanners. Devices that do not speak eSCL
 * (ScanSnap; many Brother/Canon units, including over Wi-Fi) are not listed —
 * empty state routes those users to the New Receipts folder instead.
 *
 * Option/page/filename logic lives in options.ts / pages.ts / filename.ts.
 * The folder button uses the existing shell:openPath IPC channel.
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { ScanCaps, ScanDevice, ScanOptions } from '../../shared/types.ts'
import { invoke } from '../bridge.ts'
import {
  availableColorModes,
  availableResolutions,
  availableSources,
  clampOptions,
  colorModeFromLabel,
  colorModeLabel,
  defaultOptions,
  duplexAvailable,
  sourceLabel,
  type ColorLabel,
} from './options.ts'
import { completionSummary, pageLabel, type ScanPageRow } from './pages.ts'
import './scan.css'

export interface ScanPanelProps {
  devices: ScanDevice[]
  discovering: boolean
  selectedId: string | null
  caps: ScanCaps | null
  capsLoading: boolean
  scanning: boolean
  pages: ScanPageRow[]
  error: string | null
  onRefresh: () => void
  onSelect: (deviceId: string) => void
  /** Manual "Add by IP" — orchestrator probes and adds to the list. */
  onProbe?: (host: string, port?: number) => void
  onScan: (options: ScanOptions) => void
  onCancel: () => void
  onClose: () => void
}

export function ScanPanel(props: ScanPanelProps) {
  const {
    devices,
    discovering,
    selectedId,
    caps,
    capsLoading,
    scanning,
    pages,
    error,
    onRefresh,
    onSelect,
    onProbe,
    onScan,
    onCancel,
    onClose,
  } = props

  const titleId = useId()
  const primaryRef = useRef<HTMLButtonElement>(null)
  const [ipDraft, setIpDraft] = useState('')
  const [options, setOptions] = useState<ScanOptions | null>(null)

  // Sync options when caps arrive or selection changes.
  useEffect(() => {
    setOptions(defaultOptions(caps))
  }, [caps, selectedId])

  // Focus primary control on open.
  useEffect(() => {
    primaryRef.current?.focus()
  }, [])

  // Escape closes (or cancels if scanning — cancel is more important mid-job).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (scanning) onCancel()
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scanning, onCancel, onClose])

  const sources = useMemo(() => availableSources(caps), [caps])
  const colorModes = useMemo(() => availableColorModes(caps), [caps])
  const resolutions = useMemo(() => availableResolutions(caps), [caps])
  const showDuplex = duplexAvailable(caps) && options?.source === 'Adf'
  const canScan =
    !!selectedId && !!options && !scanning && !capsLoading && !discovering && devices.length > 0
  const selected = devices.find((d) => d.id === selectedId) ?? null
  const secureSelected = selected?.secure === true
  const doneCount = pages.filter((p) => p.state === 'done').length
  const showSummary = !scanning && doneCount > 0 && pages.every((p) => p.state === 'done')

  const patchOptions = (patch: Partial<ScanOptions>) => {
    setOptions((cur) => clampOptions(caps, cur, patch))
  }

  const handleProbe = (e?: FormEvent) => {
    e?.preventDefault()
    const raw = ipDraft.trim()
    if (!raw || !onProbe) return
    // host or host:port
    const [hostPart, portPart] = raw.split(':')
    const host = (hostPart ?? '').trim()
    if (!host) return
    const port = portPart ? Number(portPart) : undefined
    onProbe(host, Number.isFinite(port) ? port : undefined)
    setIpDraft('')
  }

  const handleScan = () => {
    if (!options || !canScan || secureSelected) return
    onScan(options)
  }

  return (
    <div className="scan-scrim" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget && !scanning) onClose()
    }}>
      <div
        className="scan-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
          }
        }}
      >
        <div className="scan-head">
          <span id={titleId}>Scan</span>
          <button
            type="button"
            className="scan-close"
            aria-label="Close"
            onClick={() => (scanning ? onCancel() : onClose())}
          >
            ×
          </button>
        </div>

        <div className="scan-body">
          <div className="scan-col">
            <div className="scan-col-label">
              <span>Devices</span>
              <button
                type="button"
                className="scan-refresh"
                onClick={onRefresh}
                disabled={discovering || scanning}
              >
                {discovering ? 'Searching…' : 'Refresh'}
              </button>
            </div>

            {devices.length === 0 && !discovering && (
              <div className="scan-empty-route">
                <p className="scan-empty">
                  <strong>No network scanners found.</strong>
                  {' '}
                  KeepR finds scanners that speak eSCL (AirScan). ScanSnap, and
                  many Brother and Canon models, do not speak it at all —
                  including over Wi-Fi. Those scan through their own software
                  instead.
                </p>
                <button
                  type="button"
                  className="scan-folder-btn"
                  disabled={scanning}
                  onClick={() => {
                    void invoke('shell:openPath', { target: 'newReceipts' })
                  }}
                >
                  Open New Receipts folder
                </button>
                <p className="scan-empty-hint">
                  Point your scanner&apos;s software at that folder and KeepR
                  imports whatever lands there automatically.
                </p>
              </div>
            )}

            {devices.map((d) => (
              <button
                key={d.id}
                type="button"
                className={
                  'scan-device' + (d.id === selectedId ? ' scan-device-selected' : '')
                }
                onClick={() => onSelect(d.id)}
                disabled={scanning}
              >
                <span className="scan-device-name">{d.name}</span>
                <span className="scan-device-host">
                  {d.host}:{d.port}
                </span>
                {d.secure && (
                  <span className="scan-device-secure">
                    TLS (not scannable in this version)
                  </span>
                )}
              </button>
            ))}

            <form className="scan-add-row" onSubmit={handleProbe}>
              <input
                className="scan-add-input"
                type="text"
                placeholder="Add by IP…"
                value={ipDraft}
                onChange={(e) => setIpDraft(e.target.value)}
                disabled={scanning || !onProbe}
                aria-label="Add scanner by IP address"
              />
              <button
                type="submit"
                className="scan-add-btn"
                disabled={scanning || !onProbe || !ipDraft.trim()}
              >
                Add
              </button>
            </form>
          </div>

          <div className="scan-col">
            <div className="scan-col-label">
              <span>Options</span>
            </div>

            {capsLoading && (
              <p className="scan-empty">Loading capabilities…</p>
            )}

            {!capsLoading && selected && !caps && !error && (
              <p className="scan-empty">Select a device to load options.</p>
            )}

            {options && caps && (
              <>
                <div className="scan-opt-row">
                  <label htmlFor="scan-source">Source</label>
                  <select
                    id="scan-source"
                    className="scan-select"
                    value={options.source}
                    disabled={scanning || sources.length === 0}
                    onChange={(e) =>
                      patchOptions({
                        source: e.target.value as 'Platen' | 'Adf',
                      })
                    }
                  >
                    {sources.map((s) => (
                      <option key={s} value={s}>
                        {sourceLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="scan-opt-row">
                  <label htmlFor="scan-color">Color</label>
                  <select
                    id="scan-color"
                    className="scan-select"
                    value={colorModeLabel(options.colorMode)}
                    disabled={scanning || colorModes.length === 0}
                    onChange={(e) =>
                      patchOptions({
                        colorMode: colorModeFromLabel(e.target.value as ColorLabel),
                      })
                    }
                  >
                    {colorModes.map((m) => (
                      <option key={m} value={colorModeLabel(m)}>
                        {colorModeLabel(m)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="scan-opt-row">
                  <label htmlFor="scan-dpi">Resolution</label>
                  <select
                    id="scan-dpi"
                    className="scan-select"
                    value={options.dpi}
                    disabled={scanning || resolutions.length === 0}
                    onChange={(e) =>
                      patchOptions({ dpi: Number(e.target.value) })
                    }
                  >
                    {resolutions.map((r) => (
                      <option key={r} value={r}>
                        {r} dpi
                      </option>
                    ))}
                  </select>
                </div>

                {showDuplex && (
                  <label className="scan-check-row">
                    <input
                      type="checkbox"
                      checked={options.duplex === true}
                      disabled={scanning}
                      onChange={(e) => patchOptions({ duplex: e.target.checked })}
                    />
                    <span>Duplex</span>
                  </label>
                )}
              </>
            )}

            {pages.length > 0 && (
              <div className="scan-progress-list" aria-live="polite">
                {pages.map((row) => (
                  <div
                    key={row.n}
                    className={
                      'scan-prog-item' +
                      (row.state === 'done'
                        ? ' scan-prog-done'
                        : row.state === 'scanning'
                          ? ' scan-prog-scanning'
                          : row.state === 'failed'
                            ? ' scan-prog-failed'
                            : '')
                    }
                  >
                    <span className="scan-prog-dot" aria-hidden />
                    <span>{pageLabel(row)}</span>
                  </div>
                ))}
              </div>
            )}

            {showSummary && (
              <div className="scan-summary">{completionSummary(doneCount)}</div>
            )}

            <p className="scan-note">
              Pages are saved to Old Receipts and imported to the Inbox. If
              import fails, files move to New Receipts so they stay visible as
              unprocessed.
            </p>

            {error && (
              <div className="scan-error" role="alert">
                {error}
              </div>
            )}

            {secureSelected && (
              <div className="scan-error" role="alert">
                This scanner advertises TLS (eSCL over HTTPS). KeepR lists it
                but cannot scan TLS devices yet.
              </div>
            )}
          </div>
        </div>

        <div className="scan-foot">
          <p className="scan-footnote">
            Network eSCL (AirScan) scanners. ScanSnap and similar devices: scan
            to the New Receipts folder instead.
          </p>
          <div className="scan-foot-actions">
            {scanning && (
              <button type="button" className="scan-btn-cancel" onClick={onCancel}>
                Cancel
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              className="scan-btn-primary"
              disabled={!canScan || secureSelected}
              onClick={handleScan}
            >
              {scanning ? 'Scanning…' : 'Scan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
