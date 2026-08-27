import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startServer } from './server-runtime.js'

describe('startServer', () => {
  let scratchRoot: string
  let stop: (() => Promise<void>) | undefined

  beforeEach(() => {
    scratchRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'skillam-runtime-test-')))
  })

  afterEach(async () => {
    if (stop) {
      await stop()
      stop = undefined
    }
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  it('picks a free port when asked for port 0', async () => {
    const started = await startServer({ dbPath: path.join(scratchRoot, 'a.db'), port: 0 })
    stop = started.stop

    expect(started.port).toBeGreaterThan(0)
  })

  it('serves health on the port it reports', async () => {
    const started = await startServer({ dbPath: path.join(scratchRoot, 'b.db'), port: 0 })
    stop = started.stop

    const response = await fetch(`http://127.0.0.1:${started.port}/health`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('creates the database file and runs migrations', async () => {
    const dbPath = path.join(scratchRoot, 'c.db')
    const started = await startServer({ dbPath, port: 0 })
    stop = started.stop

    const response = await fetch(`http://127.0.0.1:${started.port}/roles`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(fs.existsSync(dbPath)).toBe(true)
  })

  it('releases the port after stop', async () => {
    const started = await startServer({ dbPath: path.join(scratchRoot, 'd.db'), port: 0 })
    const port = started.port
    await started.stop()

    const second = await startServer({ dbPath: path.join(scratchRoot, 'e.db'), port })
    stop = second.stop

    expect(second.port).toBe(port)
  })

  it('two instances get different ports', async () => {
    const first = await startServer({ dbPath: path.join(scratchRoot, 'f.db'), port: 0 })
    const second = await startServer({ dbPath: path.join(scratchRoot, 'g.db'), port: 0 })

    expect(first.port).not.toBe(second.port)

    await first.stop()
    await second.stop()
  })

  it('reports the url it is listening on', async () => {
    const started = await startServer({ dbPath: path.join(scratchRoot, 'h.db'), port: 0 })
    stop = started.stop

    expect(started.url).toBe(`http://127.0.0.1:${started.port}`)
  })
})
