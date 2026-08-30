# ロールの合成 — スコープ階層とグループ

skillam は Skill を IAM のように配る。この文書は「どの Skill 群を、どの
プロジェクト群に紐づけるか」を決める仕組みの設計。

## いま何が足りないか

| IAM | skillam | 状態 |
|---|---|---|
| Policy | Role | ある |
| Principal | Project | ある |
| Binding | `project_roles`（`priority` 付き） | テーブルはあるが**適用側が使っていない** |
| Group / Folder | — | ない |

`buildApplyPlan(deps, project, roleId)` は単一の `roleId` しか取らない。
`project_roles` は複数行持てるのに、適用は1ロールで走る。API も
`{ roleId }` を1つ受けるだけ。

つまり階層やグループを載せる前に、**複数ロールを合成する**土台が要る。
土台なしに上物を作ると、群を定義できても適用されない。

## 3つのバインディング

ロールがプロジェクトに届く経路を3つにする。強い順に:

| 経路 | テーブル | 例 |
|---|---|---|
| 直接 | `project_roles` | このプロジェクトだけ Playwright を足す |
| グループ | `group_roles` + `project_groups` | TypeScript を使う全 PJT に TS 用ロール |
| スコープ | `scope_roles` | `~/work/company` 配下すべてに社内規約ロール |

スコープはパスの前方一致で当たる。プロジェクトを新しく置くだけで
配下のロールが降りてくる（GCP の Folder）。グループは所属を明示する
多対多で、ディレクトリ位置に縛られない（AWS の Group）。

### なぜ両方要るのか

片方では表せないものがある。

- 「`~/work/company` 配下は社内規約」— これはパスの話。グループだと
  新規 PJT のたびに所属を足す手間が出る
- 「TypeScript の PJT には TS 用ロール」— これはパスと無関係。
  `~/work` にも `~/Develop` にも散らばる

## 優先順位

弱い順に**スコープ → グループ → 直接**。同じ層の中は `priority` の昇順、
スコープ同士はパスが深いほうが強い（`~/work/company` は `~/work` に勝つ）。

この順序に意味があるのは、後述の Skill 衝突と permissions の扱いだけ。
それ以外は集合の和なので順序は効かない。

## 合成のルール

素材は4種類ある。種類ごとに合成の意味が違う。

### permissions（allow / deny）— deny が常に勝つ

allow は全ロールの和。deny も全ロールの和。そのうえで
**deny に入っているものは allow から落とす**。

```
scope(社内規約)  deny:  ["Bash(rm -rf*)"]
直接(個人用)     allow: ["Bash(rm -rf*)", "Read(*)"]
────────────────────────────────────────────
結果             allow: ["Read(*)"]
                 deny:  ["Bash(rm -rf*)"]
```

優先順位の逆をいく唯一の場所。直接バインディングのほうが強いのに、
弱いはずのスコープの deny が勝つ。IAM の明示的拒否と同じ理屈で、
これを許さないと「上位で禁じたものが下位で復活する」— 社内規約を
個人ロールで空文化できてしまい、規約が規約でなくなる。

### Skill / Agent — 同名衝突は止める

名前が同じで**指す先が違う**ものが複数ロールから来たら、
`RoleCompositionConflictError` で適用を中止する。

```
group(TS用)   skill "playwright" → ~/.claude/skills/playwright
直接(個人用)  skill "playwright" → ~/Develop/my-playwright
────────────────────────────────────────────
結果          エラー。どちらを使うか人が決める
```

優先順位で後勝ちにはしない。skillam は既に `GitTrackedTargetError` で
「曖昧なら推測せず止める」契約を持っている。ここで黙って片方を選ぶと、
利用者は**自分が選んでいない Skill が入っていることに気づけない**。
プレビューに差分は出るが、衝突が起きたという事実は出ない。

指す先が同じなら衝突ではない。重複として畳む。

### MCP サーバー — 同名衝突は止める

Skill と同じ。同名で command か env が違えばエラー。
同一なら畳む。

## スキーマ

```sql
CREATE TABLE groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_groups (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, group_id)
);

CREATE TABLE group_roles (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, role_id)
);

CREATE TABLE scopes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE scope_roles (
  scope_id INTEGER NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope_id, role_id)
);
```

`scopes` を `auto_detect_roots` と統合しない。検出（どこを探すか）と
適用（何を配るか）は別の関心事で、「探すが配らない」ディレクトリも
「配るが探さない」ディレクトリもありうる。

## 適用エンジンの改修

`buildApplyPlan` は前半で「1ロールから素材を集める」、後半で「合成して
plan を作る」という2段構え。**前半だけを差し替える**。

```
現在:  buildApplyPlan(deps, project, roleId)
         ├ deps.skills.listForRole(roleId)
         └ ... 後半（plan 生成）

変更後: resolveRoles(deps, project) → RoleBinding[]
        composeRoles(bindings) → ComposedRole   ← 衝突検出と deny 優先はここ
        buildApplyPlan(deps, project, composed)
         └ ... 後半（plan 生成）は変えない
```

後半（`planSettings` / `planMcp` / `planMaterialize`、git 追跡ガード、
プロジェクト外書き込みガード）は素材の出どころを問わないので手を入れない。
`ManagedState` による削除追跡もそのまま効く。

### 履歴との整合

`apply_history.role_id` は単一の外部キー。合成後は「どのロール群が
当たったか」なので、`role_id` は残しつつ（直接バインディングがあれば
それ、なければ NULL）、内訳は `managed_json` と同じ扱いで
`bindings_json` に記録する。過去の履歴行は `bindings_json` が空でも
読めなければならない（ドリフト検知が履歴を遡るため）。

## プレビューに出すもの

合成は「なぜこの Skill が入るのか」が見えないと使えない。プレビューに
**各項目の出どころ**を出す。

```
skills/
  playwright     ← group: TypeScript
  drawio         ← scope: ~/work/company
  my-tool        ← 直接
permissions.deny
  Bash(rm -rf*)  ← scope: ~/work/company（allow から除外した）
```

deny によって allow から落ちたものは、落ちた事実を明示する。
黙って消すと「なぜ効かないのか」が分からなくなる。

## 段階

1. **複数ロール合成** — `composeRoles` と衝突検出、`project_roles` の
   複数行を実際に適用。スキーマ変更なし
2. **グループ** — `groups` / `project_groups` / `group_roles`
3. **スコープ** — `scopes` / `scope_roles`、パス前方一致の解決
4. **UI** — 群の管理画面と、プレビューの出どころ表示

1 が終われば `project_roles` に複数行入れて使える。2〜4 はその上に載る。

## 決めていないこと

- グループの入れ子（group が group を含む）は作らない。IAM でも
  ネストは混乱の元で、必要になってから考える
- スコープの除外（`~/work` 配下だが `~/work/sandbox` は対象外）は
  段階3で判断する。`projects.excluded` で個別に外せるので当面は足りる
