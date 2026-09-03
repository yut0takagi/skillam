# Homebrew Cask

`brew install --cask skillam` の中身。Cask の**正本はこのディレクトリ**にあり、
配布に使う tap リポジトリへはリリースのたびにコピーする。

## なぜ tap が別リポジトリなのか

Homebrew は tap のリポジトリ名が `homebrew-<名前>` であることを要求する。
`yut0takagi/skillam` はこの規約に合わないので、それ自体を tap にはできない。
そのため配布用に `yut0takagi/homebrew-tap` を別に持ち、利用者は

```bash
brew tap yut0takagi/tap                     # homebrew- は省略して書く
brew trust --cask yut0takagi/tap/skillam    # 公式以外の tap には trust が要る
brew install --cask skillam
```

で入れる。tap 側に置くのは `Casks/skillam.rb` だけで、レビューの対象になる
コメントや運用手順（このファイル）はこちらに残す。tap を「生成物の置き場」に
留めることで、Cask の変更理由が skillam 側の履歴に残る。

homebrew-cask 本体への登録は知名度などの要件があるため、当面は自前 tap のみ。

## リリースのたびにやること

前提として、そのタグの GitHub Releases に `.dmg` が上がっていること
（署名と公証は [DISTRIBUTION.md](../../docs/DISTRIBUTION.md) のとおり）。

```bash
# 1. Cask をそのタグに向ける
node packaging/homebrew/update-cask.mjs v0.2.1

# 2. 記法を確認する
brew style packaging/homebrew/skillam.rb

# 3. tap へ反映する（TAP は yut0takagi/homebrew-tap のクローン先）
cp packaging/homebrew/skillam.rb "$TAP/Casks/skillam.rb"
```

`update-cask.mjs` は sha256 を GitHub が公表しているアセットの `digest` から
取る。`.dmg` は2つで約 280 MB あるので、チェックサムのために落とし直さない。

そのタグでのビルドが GitHub に digest を持たない場合（古いアセット）は
スクリプトが止まり、手元の成果物から計算するコマンドを出す。

CI やリリース前の確認では `--check` を使う。書き換えずに、今の `skillam.rb` が
そのタグと一致しているかだけを見て、違えば差分を出して終了コード 1 を返す。

```bash
node packaging/homebrew/update-cask.mjs v0.2.1 --check
```

## 動作確認

tap に置いたあと、実際に入れてみる。

```bash
brew tap yut0takagi/tap
brew trust --cask yut0takagi/tap/skillam
brew install --cask skillam
brew uninstall --cask skillam
```

`brew audit --cask skillam` は tap に入っている Cask にしか使えない
（パス指定は拒否される）ので、tap へ反映したあとに回す。
反映前に確認できるのは `brew style` までになる。

**`brew trust` は audit にも要る。** trust していない tap の Cask は
`brew audit` / `brew info` からも読み込みを拒否される
（`Refusing to load cask ... from untrusted tap`）。trust は
`~/.homebrew/trust.json`（`XDG_CONFIG_HOME` があればその配下）に記録される
ローカルの設定で、リポジトリ側では解除できない。**利用者側でも必要な手順**
なので、README のインストール手順から落とさないこと。

## アンインストールで何が残るか

| コマンド | `skillam.app` | `~/.skillam/skillam.db` | キーチェーンの鍵 |
|---|---|---|---|
| `brew uninstall --cask skillam` | 消える | 残る | 残る |
| `brew uninstall --zap --cask skillam` | 消える | 消える | 残る |

`zap` に `~/.skillam` を入れているのは、Homebrew では `--zap` が
「設定ごと全部消す」という明示的な意思表示であるため。既定の
`brew uninstall` では触らない。

ただし **DB を消しても、skillam が既に書いた設定は元に戻らない。**
消えるのは「skillam が書いた」という記録のほうで、プロジェクトや
`~/.claude` に入った設定はそのまま残る。次の適用はそれを自分の書いたものと
判別できないので、削除対象にせず放置する（「自分が書いたものしか消さない」の
裏返し）。この危険は Cask の `caveats` で先に伝えている。

キーチェーンの暗号鍵（service `skillam` / account `master-key`）は Homebrew の
どのスタンザでも消せない。`caveats` で `security delete-generic-password` を
案内している。

## 手動導入から移行するとき

`.dmg` で入れた `skillam.app` が `/Applications` にあると、素の
`brew install --cask skillam` は次で中止する（既存アプリは無傷のまま）。

```
Error: yut0takagi/tap/skillam: It seems there is already an App at '/Applications/skillam.app'.
```

同じバージョンなら `--adopt` で既存のアプリを Homebrew 管理下に引き取れる。
入れ直しにならないので、こちらを案内する。

```bash
brew install --cask --adopt skillam
```

## userData ディレクトリについて

`zap` に入れている `~/Library/Application Support/@skillam` は誤記ではない。

`apps/desktop/src` は `app.setPath('userData', ...)` を呼んでいないので、
Electron は `app.getName()`（＝パッケージ後の package.json の `name`）に
フォールバックする。それが `@skillam/desktop` なので、Chromium はスラッシュを
パス区切りとして扱い、プロファイルを1段深く作る。

```
~/Library/Application Support/@skillam/desktop/
```

npm のスコープ名が、利用者に見える場所へそのまま漏れている状態。動作には
影響しないが意図した形ではないので、直すなら `productName` に合わせて
`app.setName('skillam')` を入れることになる。**その変更はウィンドウ位置などの
保存状態を捨てることになる**（プロファイルの場所が変わる）ので、Cask とは
別に判断する。ここでは実際に作られるパスに合わせてある。

## 申し送り

- **arch を1つにまとめられる。** #25 の universal ビルドが入れば
  `arch` スタンザと2つの sha256 が不要になる。そのとき
  `update-cask.mjs` の `ARCHITECTURES` も同時に直す
  （書き換え対象の行が見つからなければスクリプトが止まるようにしてある）。

- **`auto_updates` は書いていない。** #23 の自動更新が未実装で、更新経路は
  `brew upgrade --cask skillam` だけだから。electron-updater が入ったら、
  Cask 側は `auto_updates true` にして `brew upgrade` の対象から外す。
