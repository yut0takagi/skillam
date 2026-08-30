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
| Group / Folder | グループ / スコープ | **これから（段階2・3）** |

設計は [ROLE-COMPOSITION.md](ROLE-COMPOSITION.md) に全部書いてある。
実装に入る前にそこを読むこと。この文書は進捗と申し送りだけ。

## リポジトリの状態

```
main                             67c3704
feature/phase-8-role-composition ad27d17  ← PR #12 (open)
```

作業ツリーは clean。Phase 6 / 7 は PR #10 / #11 でマージ済み。

**PR #12 がレビュー待ち。** マージされたら `main` を pull してから段階2に入る。

## 段階と進捗

| 段階 | 内容 | 状態 |
|---|---|---|
| 1 | 複数ロール合成 | **完了**（PR #12） |
| 2 | グループ — `groups` / `project_groups` / `group_roles` | 未着手 |
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

## 次にやること（段階2: グループ）

1. マイグレーション `0005_groups.sql` — スキーマは
   [ROLE-COMPOSITION.md](ROLE-COMPOSITION.md#スキーマ) にそのまま書いてある
2. `GroupsRepository` / `ProjectGroupsRepository` / `GroupRolesRepository`
3. `apply.routes.ts` の `resolveBindings` にグループ経路を足す
   （いま `project_roles` しか見ていない）
4. グループ CRUD の API

`composeRoles` は `origin: { kind: 'group', name }` を既に受け付ける。
合成側に足すものはない。

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

## 検証コマンド

```bash
npm test                                    # server + web（これを使う）
npx tsc --noEmit -p apps/server/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
```

現在: server 472 / web 124 通過、型は server・web とも clean。

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
