# Security

## Scope

KeepR is a local desktop application. It has no server, no account, and makes no
network requests at runtime — the OCR language data and wasm core are bundled
precisely so it never needs to.

That shapes what a vulnerability looks like here. The realistic concerns are:

- **Path traversal on import.** A crafted filename or PDF that causes a write
  outside the library root. Media paths are validated and library-relative for this
  reason.
- **A malicious image or PDF** exploiting `sharp`/libvips or `pdfjs`. These process
  untrusted files by definition.
- **Renderer escape.** The preload bridge exposes only declared IPC channels: no
  `fs`, no `child_process`, no database handle, no raw `ipcRenderer`. A way around
  that boundary is a real finding.
- **Data corruption or silent money errors.** Not a classic security issue, but
  treated with the same seriousness: a wrong total the user files is real harm.

## Reporting

Open a [private security advisory](../../security/advisories/new) rather than a
public issue. If that is unavailable, open an issue saying only that you have a
security report and asking for a contact — do not include details.

Please include what you did, what happened, and the platform. A proof of concept
helps enormously.

This is a small hobby project maintained in spare time. There is no SLA. Reports
will be looked at as soon as reasonably possible, and credited unless you prefer
otherwise.

## The HTTP API

KeepR exposes an HTTP API on `127.0.0.1:17915` for headless testing and
automation. It is **unauthenticated and bound to localhost only**, which is
appropriate for a local tool and would not be if it were ever bound to a routable
interface. Do not expose it. If you find a way to make it bind elsewhere, that is a
finding.

## Releases

Current builds are **unsigned** on both platforms. Verify the checksum on the
release page if that matters to you. Signing is wanted; it needs certificates the
project does not have.
