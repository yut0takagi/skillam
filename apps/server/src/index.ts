// apps/server/src/index.ts
import { resolveDbPath } from './db/client.js'
import { startServer } from './server-runtime.js'

startServer({ dbPath: resolveDbPath(), port: 4317 })
  .then((started) => {
    console.log(`skillam server listening at ${started.url}`)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
