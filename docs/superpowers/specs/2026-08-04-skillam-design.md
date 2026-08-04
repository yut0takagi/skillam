# skillam 設計書

- 日付: 2026-08-04
- ステータス: レビュー待ち

## 1. 目的

Claude Code の各プロジェクトが「どのSkillsを使えるか」「どのMCPサーバーに接続するか」「どのサブエージェントを使えるか」「どんなtool permissions を持つか」を、IAMロールのような形でまとめて定義・管理・適用するローカルツール。

複数プロジェクトを横断してClaude Codeの構成を管理している状況で、プロジェクトごとにバラバラに `.claude/settings.json` や `.mcp.json` を手で書き換えるのではなく、「ロール」という単位で構成をまとめ、プロジェクトへの割り当て・適用・差分確認を一元的に行えるようにする。

## 2. 用語

| 用語 | 意味 |
|---|---|
| ロール (Role) | Skills / MCPサーバー / サブエージェント / Permissions の組み合わせをまとめた定義 |
| カタログ (Catalog) | ローカル環境をスキャンして見つかった、ロールに組み込める候補一覧（Skills/MCP/Agents） |
| プロジェクト (Project) | skillam に登録されたローカルディレクトリ（Claude Codeプロジェクト） |
| 適用 (Apply) | あるロールをあるプロジェクトの実ファイル（`.claude/settings.json` 等）に反映する操作 |
| ドリフト (Drift) | 最後に適用したロール定義と、プロジェクトの現在のファイル内容が食い違っている状態 |

## 3. スコープ

### 含む
- Skills / MCPサーバー / サブエージェント / Permissions をまとめた「ロール」の作成・編集
- ローカル環境（ユーザーレベル・プロジェクトレベル・プラグイン）のスキャンによるカタログ収集
- プロジェクトの自動検出（確認付き登録）と手動登録・除外
- ロールのプロジェクトへの適用（マージ方式・適用前diffプレビュー・履歴記録）
- MCPサーバー接続情報に含まれるシークレットのローカル暗号化保管・適用時注入
- ロール定義（シークレットを除く）のJSONエクスポート/インポート
- ドリフト検知（プロジェクトの実ファイルと最終適用ロールの差分表示）

### 含まない（将来拡張）
- チーム間でのシークレット共有・複数マシン間の自動同期
- hooksの管理
- `npx skillam` としての配布パッケージング
- 複数ロールの自動合成のUI/ロジック（テーブル設計は対応済み）
- 定期的な自動再適用（cron等）

## 4. アーキテクチャ

```
skillam/
├── apps/
│   ├── server/          # Fastify API（TypeScript）
│   │   └── src/
│   │       ├── catalog/     # Skills/MCP/Agents スキャナー
│   │       ├── roles/       # ロールCRUD
│   │       ├── projects/    # プロジェクト登録・自動検出
│   │       ├── apply/       # 差分計算・マージ適用
│   │       ├── secrets/     # Keychain連携・暗号化
│   │       └── db/          # SQLiteスキーマ・マイグレーション
│   └── web/              # Vite + React（TypeScript）
│       └── src/pages/       # Dashboard / Roles / Projects / Catalog / Settings
└── package.json (workspaces)
```

- 実データ（SQLite DB）は `~/.skillam/skillam.db` に保存。リポジトリ自体はコードのみを持つ
- `npm run dev` で server（Fastify）と web（Vite）を同時起動し、ブラウザ（`localhost`）から操作するローカル専用ツール
- 技術選定の理由: ロールビルダー・diffビューア・Markdownエディタなど状態の多いUIを扱うため、Reactによる状態管理を採用。バックエンドはファイルI/O・JSON操作中心のため軽量なFastifyで十分

## 5. データモデル（SQLite）

```sql
-- ロール本体
roles (id, name, description, created_at, updated_at)

-- ロールに紐づくSkills（カタログ参照）
role_skills (role_id, skill_source, skill_path)
  -- skill_source: 'user' | 'project-local' | 'plugin'

-- ロールに紐づくMCPサーバー定義
role_mcp_servers (id, role_id, name, command_json, env_json)
  -- env_json内の値は環境変数参照 or secret_ref:xxx の形で保持

-- シークレット（暗号化）
secrets (id, ref_name, encrypted_value, created_at, updated_at)
  -- role_mcp_servers.env_json から secret_ref 経由で参照される

-- ロールに紐づくサブエージェント定義
role_agents (id, role_id, name, markdown_body, source)
  -- source: 'reference'（既存.mdへのパス参照）| 'authored'（skillam上で作成、bodyを保持）

-- ロールに紐づくpermissions
role_permissions (role_id, permissions_json)
  -- settings.json の permissions.allow/deny 相当

-- プロジェクト登録
projects (id, path, name, auto_detected, excluded, last_applied_role_id, last_applied_at)

-- プロジェクトへのロール割り当て（多対多、将来のロール合成に備える）
project_roles (project_id, role_id, priority)

-- 適用履歴（diff監査・失敗記録用）
apply_history (id, project_id, role_id, diff_json, status, applied_at)
  -- status: 'success' | 'failed'
```

`secrets` テーブルは暗号化済みの値そのものを保持し、`role_mcp_servers` 側は参照キーのみを持つ。これにより、ロールをエクスポートする際に自然にシークレットを除外できる。

## 6. カタログスキャン

ロール編集画面で選択できる候補一覧を、以下のローカル環境スキャンによって収集する。

| 対象 | スキャン場所 |
|---|---|
| Skills | `~/.claude/skills/*`、`~/.claude/plugins/cache/*/*/skills/*`（プラグイン提供分）、登録済み各プロジェクトの `.claude/skills/*` |
| MCPサーバー | `~/.claude.json`（ユーザーレベル）、各プロジェクトの `.mcp.json` / `.claude/settings.json` の `mcpServers` |
| サブエージェント | `~/.claude/agents/*.md`、プラグイン提供分、各プロジェクトの `.claude/agents/*.md` |
| Permissions | 各プロジェクトの `.claude/settings.json` の `permissions` を参照候補として提示（既存設定のコピー元として利用可能） |

スキャン結果は「発見元」付きでカタログに保持する。既存のMCPサーバー定義にシークレットが含まれる場合は、値を `secrets` テーブルへ退避し、参照に置き換えてカタログ化する。

実際に書き込むべき `.claude/settings.json` / `.mcp.json` のキー構造（`enabledPlugins` の具体的な形式など）は、実装計画フェーズでこのマシン上の実ファイルを参照して確定する。

## 7. ロール適用フロー

マージ方式（skillamが管理するキーのみ書き換え、プロジェクト固有の手動設定は温存）、かつ毎回diffプレビューで確認するフロー。

```
1. ユーザーが「Project X に Role Y を適用」を実行
2. サーバー側で以下を生成:
   - .claude/settings.json の管理対象キー（permissions, enabledPlugins等）の新しい値
   - .mcp.json の mcpServers（シークレットは復号してから注入）
   - .claude/skills/ 配下に必要なシンボリックリンク/コピーの差分
   - .claude/agents/ 配下に必要なファイルの差分
3. 各ファイルについて「現在の内容」と「適用後の内容」をdiff表示（管理対象キーのみ）
4. ユーザーが確認して「適用」を押すと実際に書き込み、apply_history に記録
5. 書き込み後、ファイルシステム上の実ファイルが正
```

**ドリフト検知**: プロジェクト一覧画面で、各プロジェクトの現在のファイル内容と最後に適用したロール定義を比較し、ズレがあればバッジ表示する。

## 8. シークレット管理

- 初回起動時にランダムなマスターキー（256bit）を生成し、macOSキーチェーンに `security add-generic-password` で保存（サービス名: `skillam`）
- 保存/参照は Node から `security` CLI をラップして実行（ネイティブ依存を避ける）
- シークレット値は AES-256-GCM でDB列に暗号化保存
- 復号は「ロール適用時」「シークレット編集画面でマスク解除操作時」のみメモリ上で行い、平文をDBやログに残さない
- UI上のシークレット入力欄は `type=password`、一覧では末尾4文字のみ表示

## 9. プロジェクトレジストリ

- 設定画面で「自動検出ルート」を1つ以上登録（例: `~/Develop`）
- 起動時 or 手動リフレッシュで、ルート配下を再帰的に走査し `.claude/` または `.git` を持つディレクトリを候補として抽出（`node_modules` 等は除外）
- 検出結果は「未登録」として一覧表示し、ユーザーが個別に「登録」または「無視リストに追加」を選ぶ（自動登録はしない）

## 10. エクスポート/インポート

- ロール単位でJSONエクスポート。`role_mcp_servers.env_json` はシークレット参照キーのみを含み、`secrets` テーブルの中身（暗号化値）は含めない
- インポート時、シークレット参照が未解決な場合は「値を入力してください」というプレースホルダー状態のロールとして取り込む

## 11. UI画面構成

- **Dashboard**: プロジェクト一覧（登録済み＋未登録検出分）、ドリフトバッジ
- **Roles**: ロール一覧 → ロール編集画面（Skills/MCP/Agents/Permissionsをタブ分けしてチェックボックス選択・Markdownエディタ）
- **Projects → Detail**: 割当ロール、適用ボタン→diffモーダル→確認→適用、適用履歴
- **Catalog**: スキャン結果一覧、手動リフレッシュボタン
- **Settings**: 自動検出ルート管理、マスターキー再生成（キーチェーン再登録）

## 12. エラーハンドリング方針

- ファイル書き込み失敗（権限なし等）はロールバックせず、エラー内容をそのままUIに表示。部分書き込みが起きた場合は `apply_history` に `failed` として記録し、次回diffで実態と比較できるようにする
- キーチェーンアクセス失敗時は明確なエラーメッセージを表示する（例:「キーチェーンにアクセスできません。ターミナルのアクセス許可を確認してください」）
- 破壊的操作（プロジェクトからのロール解除、シークレット削除）は確認ダイアログを挟む

## 13. テスト方針

- **server**: Vitest でカタログスキャン・diff生成・マージロジック・暗号化/復号のユニットテスト（キーチェーンはモック）
- **web**: 主要コンポーネント（ロール編集フォーム、diffビューア）のコンポーネントテスト
- **E2E**: 手動確認中心。ローカル専用ツールのためMVPでは自動E2Eは含めない
