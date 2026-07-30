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

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv)
  console.log(`[keepr] opening library at ${args.library}`)

  const ctx = createContext({ libraryRoot: args.library })
  console.log(`[keepr] schema version ${ctx.schemaVersion}, inbox #${ctx.inboxId}`)

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
