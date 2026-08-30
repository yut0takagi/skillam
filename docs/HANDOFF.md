# 引き継ぎ — ロール合成とPJT群への配布

## いま何をやっているか

skillam は Skill を IAM のように配るツール（**Skill + IAM = skillam**）。
いま作っているのは「**この PJT 群にだけ、この Skill 群を配る**」を成立させる
仕組み。

| IAM | skillam | 状態 |
|---|---|---|
| Policy | Role | できている |
| Principal | Project | できている |
| Binding | `project_roles` | **段階1で実際に効くようにした** |
| Group / Folder | グループ / スコープ | グループは**できた**（段階2）。スコープはこれから（段階3） |

設計は [ROLE-COMPOSITION.md](ROLE-COMPOSITION.md) に全部書いてある。
実装に入る前にそこを読むこと。この文書は進捗と申し送りだけ。

## リポジトリの状態

段階1（複数ロール合成）は main に入っている。Phase 6 / 7 も同様
（PR #10 / #11 / #12）。

**次の作業は main から直接ブランチを切って始められる。**

段階2以降のブランチは `main` を pull してから切ること。マージ済みの
`feature/phase-6-distribution` / `phase-7-git-safe-writes` /
`phase-8-role-composition` はローカルに残っていれば消してよい。

## 段階と進捗

| 段階 | 内容 | 状態 |
|---|---|---|
| 1 | 複数ロール合成 | **完了**（PR #12） |
| 2 | グループ — `groups` / `project_groups` / `group_roles` | **完了** |
| 3 | スコープ — `scopes` / `scope_roles`、パス前方一致 | 未着手 |
| 4 | UI — 群の管理画面、プレビューの出どころ表示 | 未着手 |

段階1で `project_roles` に複数行入れて使えるようになった。2〜3 はその上に
バインディングの経路を足すだけで、合成エンジンには手を入れない設計。

## 段階1で作ったもの

`apps/server/src/apply/compose-roles.ts` が合成エンジン。ここに判断が全部
入っている。

- **deny は allow に勝つ** — 優先順位（scope < group < direct）の逆をいく
  唯一の場所。これを許さないと組織向けの制限を個別ロールの allow で
  空文化できてしまう
- **同名で内容が違えば中止** — `RoleCompositionConflictError`。優先順位で
  後勝ちにしない。プレビューには結果の差分しか出ないため、黙って選ぶと
  利用者は自分が選んでいない Skill が入ったことに気づけない
- **同じロール内の名前衝突は素通し** — 合成の問題ではないので従来どおり
  `MaterializeConflictError` に任せる

`buildApplyPlan` は `buildApplyPlanForRoles` の薄いラッパとして残してある。
単一バインディングの合成は恒等変換なので既存の呼び出し側は無傷
（同一プランを返すテストで固定済み）。

## 段階2で作ったもの

`0005_groups.sql` で `groups` / `project_groups` / `group_roles` を追加。
設計書のスキーマそのままで、`scopes` は段階3に残してある。

- `src/groups/` — `GroupsRepository` / `ProjectGroupsRepository` /
  `GroupRolesRepository` と CRUD の API（`groups.routes.ts`）
- `GroupRolesRepository.listForProject` が、プロジェクトが属する全グループの
  バインディングを**1クエリ**で返す。グループ名を一緒に返すのは、
  `composeRoles` が各項目に `{ kind: 'group', name }` を刻むため。
  後から名前を引くとバインディング1件ごとに往復が増える
- `resolveBindings` はグループ経路と直接経路を両方集めて返す。
  並び順は合成の優先順位を決めない（`composeRoles` が origin で自分で並べる）

`composeRoles` には**手を入れていない**。段階1の設計どおり、
バインディングの経路を足すだけで済んだ。

## 次にやること（段階3: スコープ）

1. マイグレーション `0006_scopes.sql` — `scopes` / `scope_roles`。
   スキーマは [ROLE-COMPOSITION.md](ROLE-COMPOSITION.md#スキーマ) にある
2. `ScopesRepository` / `ScopeRolesRepository`
3. `resolveBindings` にスコープ経路を足す。**パスの前方一致**で当てる。
   `composeRoles` は深いパスほど強いものとして既に並べ替える
   （`compareBindings` を見ること）
4. スコープ CRUD の API

`composeRoles` は `origin: { kind: 'scope', path }` も既に受け付ける。
段階2と同じく、合成側に足すものはないはず。

**前方一致は文字列比較で書かないこと。** `~/work` が `~/workspace` に
当たってしまう。`path.sep` 区切りで境界を見るか、`path.relative` が
`..` で始まらないことを確かめる。

### TDD で進めること

このリポジトリは全部テストが先に書かれている。段階1でも、
**既存テストが実装の誤りを2回捕まえた**（下記「踏んだ罠」参照）。
テストを後から書くとこれが効かない。

## 踏んだ罠（同じ失敗を繰り返さないために）

### 1. 同一ロール内の衝突を合成の衝突として扱ってしまった

`collectNamed` で名前が衝突したら全部 `RoleCompositionConflictError` に
していた。既存テスト「basename が衝突したら `MaterializeConflictError`」が
落ちて発覚。

1つのロールの中で名前が衝突するのは**そのロールの定義が壊れている**話で、
バインディング間の不一致とは別物。ロールが1つしかないのに「どちらかの
ロールを外せ」と言うのは誤った案内になる。

さらに、素通しにするだけでは足りなかった。名前で Map に畳んでいたため
2件目が消え、`materialize` に衝突が届かなくなった。**畳まず両方通す**
必要がある（`passthrough` 配列）。

### 2. 履歴の role_id が嘘をつく実装になっていた

`plan.roleId` を `refs[0]?.roleId ?? 0` と書いていた。複数ロールを適用しても
先頭1つだけが履歴に記録され、**実際には起きていない適用を履歴が主張する**
状態だった。型エラーで発覚（テストは通っていた）。

`apply_history.role_id` は元から nullable。合成時は `null` が正しい。
`projects.last_applied_role_id` も同じ理由で合成時は更新しない。

### 3. app.ts の同名記述を取り違えて消した

コミットを2つに分けようとして `app.ts` から `projectRoles: new ...` の行を
一時的に外した際、**同じ記述が2箇所ある**うち元から存在した方
（`projectRolesRoutes` 側）を消した。

さらに `git checkout` と `git stash pop` の順序を誤り、作業ツリーと stash の
両方が壊れた状態を作った。stash の中身と作業ツリーを1ファイルずつ
突き合わせて復元した。

**教訓**: 行単位でのコミット分割は、同名の記述があるファイルでは危険。
分けるなら最初から別コミットで作業する。まとめてしまうほうが安全。

### 4. テストの実行方法を間違えて「104件失敗」と誤認した

リポジトリルートから `npx vitest run` を直接叩くと web の jsdom 設定が
読まれず、`document is not defined` で大量に落ちる。

**正しくは `npm test`**（各 workspace の設定を使う）。
個別なら `npm test -w @skillam/server` / `-w @skillam/web`。

### 5. 単一ロールでも「直接バインディング」とは限らない（段階2で発覚）

`ApplyPlan.roleId` は `refs.length === 1 ? refs[0].roleId : null` だった。
バインディングが1件なら、それが**グループ経由でも**そのロールを記録する。

結果、`project_roles` が空なのに `projects.last_applied_role_id` に値が入り、
**存在しない直接バインディングを主張する**状態になった（罠2と同じ嘘）。
`refs[0].origin.kind === 'direct'` も条件に足して修正済み。

段階3でスコープを足すと同じ経路をもう一度通る。`origin.kind` を見ずに
「1件なら記録」と書くと再発する。

## 検証コマンド

```bash
npm test                                    # server + web（これを使う）
npx tsc --noEmit -p apps/server/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
```

現在: server 539 / web 124 通過、型は server・web とも clean。

テストはすべて一時ディレクトリとインメモリ DB を使う。実際の `~/.claude` や
`~/.skillam` には触れない。**この約束は環境変数の優先順位（引数 > 環境変数 >
既定値）で守られている**ので、`resolveCatalogRoots` をいじるときは注意。

## 未完了・持ち越し

段階1で作ったが、まだ繋がっていないもの。**どちらも段階4（UI）で通す。**

- **`ApplyPlan.origins`** — 各項目がどのバインディング由来かを API は返すが、
  UI に出していない。経路が3つになると「なぜこれが入っているのか」が
  見えなくなるので、UI では必ず出すこと
- **`suppressedAllow`** — deny が allow を落とした記録。`composeRoles` は
  返すが `ApplyPlan` に載せていない。設計書では「落ちた事実を明示する」と
  決めた。黙って消えると「なぜ効かないのか」が分からなくなる

## 設計上まだ決めていないこと

- **グループの入れ子**（group が group を含む）は作らない方針。IAM でも
  ネストは混乱の元。必要になってから考える
- **スコープの除外**（`~/work` 配下だが `~/work/sandbox` は対象外）は
  段階3で判断する。`projects.excluded` で個別に外せるので当面は足りる

## 作業上の約束

- **commit / push / PR 作成は毎回ユーザーの承認を取る。** 「進めて」は
  作業続行の許可であって commit の許可ではない
- 破壊的な git 操作（`git checkout -- .` など）は避ける。段階1では
  auto mode のガードに止められて助かった場面がある
