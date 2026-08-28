# 配布ビルド

macOS 向けの `.app` / `.dmg` を作る手順。

## 必要なもの

| | 用途 | 無いとどうなるか |
|---|---|---|
| Developer ID Application 証明書 | 署名 | 未署名になり、他人のMacでは「開発元を確認できません」で開けない |
| App Store Connect API キー | 公証 | 署名はされるが、他人のMacで初回に警告が出る |

証明書はキーチェーンにあれば electron-builder が自動で見つける。

## ビルド

```bash
# 署名付きビルド（arm64 + x64 の .dmg）
npm run dist -w @skillam/desktop

# 動作確認だけしたい（署名なし・高速）
CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack -w @skillam/desktop
```

成果物は `apps/desktop/release/` に出る。

## 公証（notarization）

公証を通すと、どのMacでもそのまま開ける。通さない場合、利用者は初回に
右クリック →「開く」を選ぶ必要がある。

### API キーの取得

1. [App Store Connect](https://appstoreconnect.apple.com/access/integrations/api) を開く
2. 「Keys」→ 「+」で新しいキーを作成（アクセス権は **Developer** で足りる）
3. 以下の3つを控える
   - `.p8` ファイル（**ダウンロードは1回きり**。再取得できない）
   - Key ID
   - Issuer ID

### 実行

```bash
export APPLE_API_KEY=~/private_keys/AuthKey_XXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

npm run dist -w @skillam/desktop
```

環境変数が揃っているときだけ公証が走る。揃っていなければ
**スキップした旨をログに出したうえで**ビルドは成功する
（署名済み・未公証の `.dmg` は、自分で使う分には問題なく動く）。

`.p8` はリポジトリに入れないこと。`~/private_keys/` などに置く。

### 確認

```bash
# 公証チケットが付いているか
xcrun stapler validate apps/desktop/release/mac-arm64/skillam.app

# Gatekeeper が受け入れるか
spctl -a -vvv -t install apps/desktop/release/mac-arm64/skillam.app
```

`accepted` になれば完了。`rejected — source=Unnotarized Developer ID` は
「署名は有効だが公証されていない」状態。

## パッケージの構造

`main.js` はサーバーと画面を**自分からの相対パス**で読む
（`../../server/dist`、`../../web/dist`）。そのため asar の中にも
monorepo と同じ `apps/*` の並びで配置している。

```
app.asar
├── apps/desktop/dist/   # Electron メインプロセス（CommonJS）
├── apps/server/dist/    # Fastify（ESM。dist/package.json で type: module を宣言）
├── apps/web/dist/       # ビルド済み画面
└── package.json
```

`better-sqlite3` のネイティブバイナリだけは asar の外に出している
（`.node` は asar 内から dlopen できないため）。prebuild が Electron の ABI で
そのまま動くので、ネイティブビルドは不要。

## 制約

- **Apple Silicon と Intel で別々の `.dmg` を出している。** universal 版は
  ネイティブモジュールを両アーキテクチャ分マージする必要があり、現状は
  分けたほうが確実。
- **自動更新は未対応。** 新しい版は `.dmg` を配り直す。
- **Windows / Linux は未検証。** `better-sqlite3` の prebuild は存在するが、
  ビルド設定も動作確認もしていない。
