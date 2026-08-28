import { app, BrowserWindow, shell } from 'electron'
import * as path from 'path'
import { pathToFileURL } from 'url'

interface StartedServer {
  port: number
  url: string
  stop: () => Promise<void>
}

let server: StartedServer | undefined

interface ServerRuntimeModule {
  startServer: (options: { dbPath: string; port: number }) => Promise<StartedServer>
}

interface DbClientModule {
  resolveDbPath: () => string
}

// apps/server is ESM with no type declarations emitted (declaration: false),
// so these imports have no static types and are cast at the boundary.
//
// They resolve by path rather than by the '@skillam/server' bare specifier:
// that specifier only works through the npm-workspaces symlink in
// node_modules, which is not present in a packaged app. Packaging mirrors the
// monorepo's apps/* layout, so '../../server/dist/...' relative to this file
// resolves in both the repo and the asar. pathToFileURL is required because
// a Windows path is not a valid ESM specifier.
async function loadServerRuntime(): Promise<{
  startServer: ServerRuntimeModule['startServer']
  resolveDbPath: DbClientModule['resolveDbPath']
}> {
  const serverDist = path.join(__dirname, '../../server/dist')
  const serverRuntime = (await import(
    pathToFileURL(path.join(serverDist, 'server-runtime.js')).href
  )) as ServerRuntimeModule
  const dbClient = (await import(
    pathToFileURL(path.join(serverDist, 'db/client.js')).href
  )) as DbClientModule
  return { startServer: serverRuntime.startServer, resolveDbPath: dbClient.resolveDbPath }
}

function createWindow(apiBaseUrl: string): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    title: 'skillam',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: ['--api-base-url=' + apiBaseUrl]
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.SKILLAM_DEV_URL
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(path.join(__dirname, '../../web/dist/index.html'))
  }
}

app.whenReady().then(async () => {
  const { startServer, resolveDbPath } = await loadServerRuntime()
  server = await startServer({ dbPath: resolveDbPath(), port: 0 })

  createWindow(server.url)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && server) {
      createWindow(server.url)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  const current = server
  if (!current) {
    return
  }

  event.preventDefault()
  server = undefined

  void current.stop().then(() => {
    app.quit()
  })
})
