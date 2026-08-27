import type { FastifyInstance } from 'fastify'
import { openDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { buildApp } from './app.js'

export interface StartServerOptions {
  dbPath: string
  port: number
  host?: string
}

export interface StartedServer {
  port: number
  url: string
  app: FastifyInstance
  stop: () => Promise<void>
}

export async function startServer(options: StartServerOptions): Promise<StartedServer> {
  const db = openDb(options.dbPath)
  runMigrations(db)

  const app = buildApp(db)
  const host = options.host ?? '127.0.0.1'

  await app.listen({ port: options.port, host })

  const bound = app.addresses()[0]
  if (!bound) {
    await app.close()
    db.close()
    throw new Error('サーバーがポートを取得できませんでした')
  }

  return {
    port: bound.port,
    url: `http://${host}:${bound.port}`,
    app,
    stop: async () => {
      await app.close()
      db.close()
    }
  }
}
