# デプロイ運用

対象アプリ: `hiragaunsou-vehicle-pl-extracted`（Cloudflare Workers / D1）

## 公開されるまでの経路

本番へ出る道は **main への push だけ**。手元から `wrangler deploy` を打つ運用はしない。
手元からのデプロイは git のコミットではなく**その場の作業ツリー**を固めるため、
未コミットの実験コードが本番に混ざり得る。CI 上は clean checkout なのでこの事故が構造的に起きない。

```
PR 作成
  └─ CI (hiragaunsou-vehicle-pl-ci.yml)  ※ main のマージ必須チェック
       lint → typecheck → coverage(閾値80%) → cf:build → cf-typegen
       → npm audit(high以上) → E2E(Playwright)

main へマージ
  └─ Deploy (hiragaunsou-vehicle-pl-deploy.yml)
       検査の再実行 → 本番設定の検証 → wrangler deploy --dry-run
       → 破壊的マイグレーションのガード     ← 止まるならここ
       → D1 マイグレーション適用(--remote)
       → wrangler deploy
       → 適用簿の確認
       → スモークテスト(30秒待ち→1回目→90秒待ち→2回目)
```

デプロイ完了まで約5〜6分。うち2分はスモークテストの待機時間。

## 止まる箇所と意味

| 止まった場所 | 本番の状態 | 対処 |
|---|---|---|
| ガード（破壊的マイグレーション） | **何も変わっていない** | 下記「破壊的変更を適用したいとき」参照 |
| D1 マイグレーション適用 | DBは途中まで変わった可能性がある。コードは旧のまま | 適用簿を確認し、手で整合させる |
| `wrangler deploy` | DBは新・コードは旧。**最も危険な状態** | 原因を直して再実行するか、マイグレーションを手当てする |
| スモークテスト | 公開済みだが壊れている可能性 | ログのHTTPコードを見て、必要ならロールバック |

## 破壊的マイグレーションのガード

`DROP TABLE` / `DROP COLUMN` / `DELETE FROM` / `TRUNCATE` / `RENAME` を含む**未適用の**
マイグレーションを検出すると、適用される前にデプロイが失敗する。
`DROP INDEX` は対象外（インデックスは作り直せて行データを失わない）。
SQLコメント内の記述では反応しない。

検査対象を未適用分に限っているのは、適用済みの `0005_drop_raw_ingestion_batch_idx.sql` を
毎回拾ってデプロイが恒久的に止まるのを避けるため。

### 破壊的変更を意図的に適用したいとき

1. 可能なら**2段階に分ける**。先に「旧列を読まなくなったコード」をデプロイし、
   誰も参照していない状態にしてから、削除だけのマイグレーションを次のPRで適用する。
2. どうしても一度に行う場合は、GitHub の Actions タブから
   `hiragaunsou-vehicle-pl Deploy` を **Run workflow** で手動起動し、
   `allow_destructive_migration` に `YES` を入力する。
   実行前に本番データのバックアップを取ること。

## スモークテストを2回やる理由

Cloudflare Workers は旧バージョンの実行環境（isolate）をデプロイ後1〜2分保持する。
1回だけの確認では次の両方が起こり得る。

- 直っているのに古い応答を見て「直っていない」と誤判定する
- 壊れているのに古い正常応答を見て「大丈夫」と誤判定する

手元で試す場合（待機を飛ばせる）:

```bash
APP_ORIGIN=https://hiragaunsou-vehicle-pl.daishimanju.workers.dev \
  FIRST_WAIT=0 SECOND_WAIT=5 bash .github/scripts/smoke.sh
```

## 戻し方

コードだけを直前のバージョンへ戻す（直近100バージョンまで）。
**マイグレーションで変わったDBの構造は戻らない**ので、DBを触った回のロールバックは
「旧コード × 新DB」になる点に注意する。

```bash
cd hiragaunsou-vehicle-pl-extracted
npx wrangler deployments list    # いつどれが公開されたか
npx wrangler rollback            # 直前へ戻す
```

## 設定されているもの

- **ブランチ保護**: main は `typecheck + test` が緑でないとマージ不可。
  `enforce_admins=false` なので緊急時は自分で回避できるが、**使ったら理由を残すこと**。
- **Secrets**: `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
- **Variables**: `HIRAGAUNSOU_APP_ORIGIN`（未設定時は workers.dev の既定URLを使う）
- **Cloudflare 側の Git 連携は使わない**。GitHub Actions と両方有効にすると二重にデプロイが走る。
