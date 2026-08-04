// apps/server/src/index.ts
import { openDb, resolveDbPath } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { buildApp } from './app.js'

const db = openDb(resolveDbPath())
runMigrations(db)

const app = buildApp(db)

app
  .listen({ port: 4317, host: '127.0.0.1' })
  .then((address) => {
    console.log(`skillam server listening at ${address}`)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
