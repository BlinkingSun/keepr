/**
 * Headless entry point — Lane 0, owned by the orchestrator.
 *
 * Runs the whole backend with no window, which is what the auditor drives and
 * what the release gate smoke-tests after installing on Windows. Deliberately
 * free of any Electron import so it also runs under plain node during
 * development:
 *
 *   node --experimental-strip-types src/main/serve.ts --library /tmp/keepr-dev
 *
 * The Electron main process builds the same context from the same code, so a
 * feature verified here is the same implementation the UI calls — not a parallel
 * one that can quietly diverge.
 */
import os from 'node:os'
import path from 'node:path'
import { createContext } from './context.ts'
import { KEEPR_DEFAULT_PORT, startHttpApi } from './httpApi.ts'

interface Args {
  library: string
  port: number
}

export function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const portRaw = get('--port')
  const port = portRaw ? Number(portRaw) : KEEPR_DEFAULT_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port must be a valid port, got ${portRaw}`)
  }
  return {
    library: path.resolve(get('--library') ?? path.join(os.homedir(), 'KeepR')),
    port,
  }
}


/**
 * Last-resort containment. A library app must not die because one background
 * task threw outside its promise chain — the audit's live test lost the whole
 * process (open WAL, unreaped jobs) to a single corrupt image. SQLite
 * transactions keep the data safe; staying alive is strictly better than
 * exiting mid-import. Every hit is logged loudly: these are bugs to fix, not
 * noise to ignore.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[keepr] UNHANDLED REJECTION (contained):', (reason as Error)?.stack ?? reason)
})
process.on('uncaughtException', (err) => {
  console.error('[keepr] UNCAUGHT EXCEPTION (contained):', err.stack ?? err.message)
})

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv)
  console.log(`[keepr] opening library at ${args.library}`)

  const ctx = createContext({ libraryRoot: args.library })
  console.log(`[keepr] schema version ${ctx.schemaVersion}, inbox #${ctx.inboxId}`)

  // The folder workflow runs headless too: drop a file into New Receipts and
  // the HTTP API shows the ingested item — which is exactly how it gets tested.
  ctx.startWatcher()

  const server = await startHttpApi(ctx, args.port)

  const shutdown = (signal: string) => {
    console.log(`[keepr] ${signal} — checkpointing and closing`)
    server.close()
    ctx.close()
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

// Run when invoked directly. Guarded so the module can also be imported by a
// test that wants the context without starting a listener.
const invokedDirectly =
  process.argv[1] != null && import.meta.url.endsWith(path.basename(process.argv[1]))
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`[keepr] fatal: ${(e as Error).message}`)
    process.exit(1)
  })
}
