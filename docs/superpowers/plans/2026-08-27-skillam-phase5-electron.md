# skillam Phase 5（Electron 化）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** skillam を macOS のデスクトップアプリとして起動できるようにする。アイコンをクリックすればウィンドウが開き、全画面が動き、閉じればサーバーも止まる。

**Architecture:** Electron のメインプロセス内で Fastify を直接起動する（子プロセスにしない）。`port: 0` で OS に空きポートを選ばせ、その実ポートをレンダラへ渡す。レンダラは Phase 4 の `apps/web` をビルドしたものをそのまま読み込む。

**Tech Stack:** Electron / electron-rebuild / 既存の Fastify + better-sqlite3 + React（新規のフレームワークは入れない）

---

## この構成を選んだ理由

**サーバーをメインプロセス内で直接動かす。** 子プロセスにするとクラッシュは分離できるが、アプリ終了時の後始末が難しく、ゾンビプロセスがポートを掴んだまま残る事故が起きやすい。Node ランタイムの同梱も必要になる。メインプロセス内なら、プロセスが1つなので終了処理が確実で、`listen()` の戻り値から実ポートを即座に取得できる。

**ポートを固定しない。** 4317 が使用中だとアプリが起動できないのは、デスクトップアプリとして不合理。`port: 0` を渡すと OS が空きポートを割り当てるので、その値をレンダラへ渡す。

**レンダラは Phase 4 のものをそのまま使う。** `HashRouter` への変更は Phase 4 で済ませてあるため、`file://` から読み込んでもルーティングが壊れない。

---

## 移行で触る箇所

| ファイル | 変更 |
|---|---|
| `apps/server/src/app.ts` | CORS を条件付きに（Electron では不要） |
| `apps/server/src/index.ts` | 変更なし（CLI 起動は残す） |
| `apps/server/src/server-runtime.ts` | 新規。DB を開いてサーバーを起動し、実ポートを返す関数 |
| `apps/web/src/api/client.ts` | `BASE_URL` を実行時に決定する |
| `apps/web/vite.config.ts` | `base: './'` を追加（`file://` から相対で読むため） |
| `apps/desktop/` | 新規ワークスペース。メインプロセス・preload・ビルド設定 |

---

## 計画前に実測して確定させたこと

ネイティブモジュールの扱いが最大のリスクだったので、計画を書く前に実機で検証した。以下は推測ではなく実測結果。

**ABI は一致しない。** システムの Node v24.13.1 は `NODE_MODULE_VERSION 137`、Electron 44 が内包する Node v24.18.1 は `149`。メジャー版が同じでも Electron は独自 ABI を使う。よって `electron-rebuild` は必須。

**`better-sqlite3` v11 は Electron 44 でコンパイルできない。** V8 の破壊的変更（`Context::GetIsolate` の削除、`PropertyCallbackInfo::This` の削除、`SetNativeDataProperty` の引数変更）により node-gyp が 12 件のエラーで失敗する。これは設定では回避できない。

**v13 へ上げれば通る。** `better-sqlite3` を v11.10.0 → v13.0.3 に上げると再ビルドが成功し、Electron 上で実際に SQL が動くことを確認した。既存の 352 テストは v13 でも全件パスし、API 変更の影響はなかった。

**`npm test` との両立問題は存在しない。** v13 は `prebuilds/` にプラットフォーム別バイナリを持つ配布方式に変わっており、Electron 向けに再ビルドした状態でも通常の Node から読める。352 テストが引き続き通ることを確認済み。当初懸念した「テストが壊れる」問題は、v13 では起きない。

この検証で `apps/desktop` ワークスペースの作成と、`electron@^44` / `@electron/rebuild` / `better-sqlite3@^13` の導入は既に済んでいる。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `apps/server/src/server-runtime.ts` | 新規。DB を開き、動的ポートでサーバーを起動し、実ポートと停止関数を返す |
| `apps/server/src/index.ts` | CLI 起動を `server-runtime` 経由に変更（挙動は 4317 固定のまま維持） |
| `apps/server/src/app.ts` | CORS を条件付きにする |
| `apps/web/src/api/client.ts` | `BASE_URL` を実行時に決定 |
| `apps/web/vite.config.ts` | `base: './'` |
| `apps/desktop/src/main.ts` | Electron メインプロセス |
| `apps/desktop/src/preload.ts` | レンダラへポート番号を渡す |
| `apps/desktop/tsconfig.json` | ビルド設定 |

---

### Task 1: サーバーを動的ポートで起動できるようにする

Electron から呼べる形に切り出す。CLI 起動（`npm run dev`）の挙動は変えない。

**Files:**
- Create: `apps/server/src/server-runtime.ts`
- Create: `apps/server/src/server-runtime.test.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/server-runtime.test.ts`:

```ts
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
    expect(started.port).not.toBe(0)
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
})
```

**注意**: 最後の2テストは実際にポートを掴む。`afterEach` で確実に閉じること。テスト内で 4317 を使わないこと（開発サーバーが動いている可能性がある）。

- [ ] **Step 2: 失敗を確認**

Run: `npm run test -w @skillam/server -- src/server-runtime.test.ts`
Expected: FAIL — `Cannot find module './server-runtime.js'`

- [ ] **Step 3: 実装**

`apps/server/src/server-runtime.ts`:

```ts
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

  const addresses = app.addresses()
  const bound = addresses[0]
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
```

`app.addresses()` から実ポートを取る。`listen()` の戻り値は文字列なので、パースするより確実。

- [ ] **Step 4: `index.ts` を書き換える**

挙動は変えない。ポートは 4317 固定のまま。

```ts
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
```

- [ ] **Step 5: 確認してコミット**

```bash
npm run test -w @skillam/server
npx tsc --noEmit -p apps/server/tsconfig.json
git add apps/server/src/server-runtime.ts apps/server/src/server-runtime.test.ts apps/server/src/index.ts
git commit -m "feat(server): start the server on a dynamic port"
```

---

### Task 2: レンダラが実行時にサーバーの場所を知る

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/client.test.ts`
- Modify: `apps/web/vite.config.ts`

- [ ] **Step 1: 失敗するテストを書く**

`client.test.ts` に追加:

```ts
  it('uses the port injected by the desktop shell when present', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('skillam', { apiBaseUrl: 'http://127.0.0.1:51234' })

    await apiRequest('/roles')

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:51234/roles')
  })

  it('falls back to the dev server port in a browser', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest('/roles')

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:4317/roles')
  })
```

`afterEach` の `vi.unstubAllGlobals()` が `skillam` も戻すことを確認すること。

- [ ] **Step 2: 失敗を確認 → 実装**

`apps/web/src/api/client.ts` の先頭を差し替える:

```ts
declare global {
  interface Window {
    skillam?: { apiBaseUrl: string }
  }
}

const DEV_BASE_URL = 'http://127.0.0.1:4317'

function baseUrl(): string {
  // Electron のメインプロセスが preload 経由で実ポートを注入する。
  // ブラウザで開発しているときは注入されないので、固定ポートへ落とす。
  const injected = (globalThis as { skillam?: { apiBaseUrl?: string } }).skillam?.apiBaseUrl
  return injected ?? DEV_BASE_URL
}
```

`apiRequest` 内の `` `${BASE_URL}${path}` `` を `` `${baseUrl()}${path}` `` に変える。**毎回呼ぶこと** — モジュール読み込み時に確定させると、preload の注入が間に合わない場合に固定ポートを掴んでしまう。

- [ ] **Step 3: `vite.config.ts` に `base` を追加**

```ts
export default defineConfig({
  base: './',
  plugins: [react()],
  ...
})
```

`file://` から読み込むと絶対パス `/assets/...` が解決できない。相対パスにする必要がある。

- [ ] **Step 4: 確認してコミット**

```bash
npm run test -w @skillam/web
npx tsc --noEmit -p apps/web/tsconfig.json
git add apps/web/src/api/client.ts apps/web/src/api/client.test.ts apps/web/vite.config.ts
git commit -m "feat(web): resolve the api base url at runtime"
```

---

### Task 3: CORS を条件付きにする

Electron では同一プロセス内のサーバーへ `http://127.0.0.1:<port>` で話すため、`file://` オリジンからのリクエストになる。CORS 設定はブラウザ開発時のみ必要。

**Files:**
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/app.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
  it('allows a file protocol origin so the desktop shell can call the api', async () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const app = buildApp(db)

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'file://' }
    })

    expect(response.statusCode).toBe(200)
  })
```

**この挙動を実測で確かめること。** Electron のレンダラが `file://` から `fetch` するとき、実際に `Origin` ヘッダが何になるかは環境で異なる（`null` になる場合もある）。Task 5 で実機確認したうえで、必要なら設定を調整する。テストを先に書いて、実機の結果と合わなければテストを直す — 逆にしないこと。

- [ ] **Step 2: 実装**

`origin` の配列に `file://` を足すか、関数形式にして `file://` と `null` を許可する。どちらが正しいかは Task 5 の実機確認で決める。**この Task では実装せず、テストだけ書いて Task 5 まで持ち越してよい** — 推測で設定を足すと、後で不要なものが残る。

- [ ] **Step 3: コミット（Task 5 の結果と合わせて行う）**

---

### Task 4: Electron のメインプロセス

**Files:**
- Create: `apps/desktop/src/main.ts`
- Create: `apps/desktop/src/preload.ts`
- Create: `apps/desktop/tsconfig.json`
- Modify: `apps/desktop/package.json`
- Modify: root `package.json`（`dev:app` スクリプト）

- [ ] **Step 1: `apps/desktop/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

Electron のメインプロセスは CommonJS で動かすのが確実。`apps/server` は ESM なので、メインプロセスからは動的 `import()` で読む。**この組み合わせが実際に動くか Step 4 で必ず確認すること。** 動かない場合は、メインプロセスも ESM にする（`package.json` の `type: module` と Electron のバージョン対応を確認）。

- [ ] **Step 2: `apps/desktop/src/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'

const apiBaseUrl = process.argv.find((arg) => arg.startsWith('--api-base-url='))?.split('=')[1]

contextBridge.exposeInMainWorld('skillam', {
  apiBaseUrl: apiBaseUrl ?? 'http://127.0.0.1:4317'
})
```

`contextIsolation` を有効にしたまま、レンダラへ渡す値を1つに絞る。`ipcRenderer` を露出させない。

- [ ] **Step 3: `apps/desktop/src/main.ts`**

```ts
import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'

let started: { port: number; url: string; stop: () => Promise<void> } | undefined

async function createWindow(apiBaseUrl: string) {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    title: 'skillam',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--api-base-url=${apiBaseUrl}`]
    }
  })

  // 外部リンクは既定のブラウザで開く（アプリ内で開かせない）
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.SKILLAM_DEV_URL
  if (devUrl) {
    await window.loadURL(devUrl)
  } else {
    await window.loadFile(path.join(__dirname, '../../web/dist/index.html'))
  }
}

app.whenReady().then(async () => {
  const { startServer } = await import('@skillam/server/dist/server-runtime.js')
  const { resolveDbPath } = await import('@skillam/server/dist/db/client.js')

  started = await startServer({ dbPath: resolveDbPath(), port: 0 })
  await createWindow(started.url)

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0 && started) {
      await createWindow(started.url)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async (event) => {
  if (started) {
    event.preventDefault()
    const stopping = started
    started = undefined
    await stopping.stop()
    app.quit()
  }
})
```

**`before-quit` の扱いに注意。** `event.preventDefault()` してから非同期処理を挟み、終わってから `app.quit()` を呼ぶ。`started` を先に `undefined` にしないと無限ループになる。実機で「閉じたらプロセスが残らない」ことを必ず確認すること。

**`@skillam/server/dist/...` の import が実際に解決できるか確認すること。** `apps/server/package.json` に `exports` が無いため、パス指定で読めるかは実装時に検証が要る。読めない場合の選択肢: (a) `apps/server/package.json` に `exports` を追加、(b) 相対パスで `../../server/dist/...` を読む。実測で決める。

- [ ] **Step 4: `apps/desktop/package.json`**

```json
{
  "name": "@skillam/desktop",
  "version": "0.1.0",
  "private": true,
  "license": "Apache-2.0",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "electron .",
    "rebuild": "electron-rebuild -f -w better-sqlite3"
  }
}
```

（devDependencies は既に入っている。）

- [ ] **Step 5: ルートに起動スクリプトを追加**

```json
    "dev:app": "npm run build -w @skillam/server && npm run build -w @skillam/web && npm run build -w @skillam/desktop && npm run start -w @skillam/desktop"
```

- [ ] **Step 6: 実際に起動する**

```bash
npm run rebuild -w @skillam/desktop
npm run dev:app
```

**ここで必ず実機確認すること。** 以下を1つずつ確かめ、観察した内容を報告する（期待ではなく実際に見たこと）:

1. ウィンドウが開くか
2. 画面が描画されるか（白画面なら DevTools のコンソールを見る。`base: './'` の効果、preload の注入、CORS のいずれかが原因）
3. `window.skillam.apiBaseUrl` に実ポートが入っているか
4. プロジェクト一覧が API から取れているか
5. 6画面すべて遷移できるか（`HashRouter` が `file://` で動くか）
6. ウィンドウを閉じたあと `ps` にプロセスが残らないか
7. ポートが解放されるか（`lsof -i :<port>`）

**白画面になった場合、推測で直さないこと。** DevTools のコンソールに出ているエラーを読んで、それに対応する。

- [ ] **Step 7: 確認してコミット**

```bash
npm test
npx tsc --noEmit -p apps/desktop/tsconfig.json
git add apps/desktop package.json
git commit -m "feat(desktop): launch skillam as an electron app"
```

---

### Task 5: 実機確認と後始末

**Files:** 必要に応じて `app.ts`（CORS）、`main.ts`

- [ ] **Step 1: Task 4 の実機確認で出た問題を直す**

Task 3 で保留した CORS 設定を、実際の `Origin` ヘッダの値に基づいて決める。Electron の DevTools の Network タブで、レンダラが送っている `Origin` を確認する。

- [ ] **Step 2: DB の所在を確認**

アプリから起動したとき、DB が `~/.skillam/skillam.db` に作られることを確認する。**開発用の使い捨て DB と混ざらないこと。** `SKILLAM_DB_PATH` を指定して起動する経路も用意されているか確認する（Electron では環境変数が渡らない場合がある）。

- [ ] **Step 3: 二重起動の挙動を確認**

アプリを2つ起動したらどうなるか。それぞれ別ポートを取るが、同じ DB ファイルを開くことになる。SQLite の WAL モードなので致命的ではないが、`app.requestSingleInstanceLock()` で1つに制限すべきか判断する。**実際に試してから決める。**

- [ ] **Step 4: 全テストと型チェック**

```bash
npm test
npx tsc --noEmit -p apps/server/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
npx tsc --noEmit -p apps/desktop/tsconfig.json
```

- [ ] **Step 5: README を更新**

「使い方」に、アプリとして起動する方法を追記する。ブラウザ版（`npm run dev`）も開発用途として残す。

- [ ] **Step 6: コミット**

---

## Phase 5 Definition of Done

- `npm run dev:app` でウィンドウが開き、6画面すべてが動く
- サーバーは動的ポートで起動し、レンダラがその実ポートへ話す
- ウィンドウを閉じるとサーバーも止まり、プロセスとポートが残らない
- DB は `~/.skillam/skillam.db`（開発用の使い捨て DB と混ざらない）
- `npm test` が引き続き全件パスする（Electron 向け再ビルドが通常の Node のテストを壊さない）
- README にアプリとしての起動方法が書かれている

## 次フェーズ（この計画には含まない）

- **配布**: `electron-builder` による `.app` / `.dmg` 生成、アイコン、署名・公証（Apple Developer アカウントが必要）
- **Phase 3b**: ドリフト検知、ロール定義のエクスポート/インポート
- **自動更新**: 配布形態が決まってから検討
