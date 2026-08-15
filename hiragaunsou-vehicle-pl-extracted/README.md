# 車両収支管理システム

運送会社の車両別収支をクラウド上で集計・分析し、月次入力、異常検知、赤字要因の把握を効率化するためのNext.js(Cloudflare Workers/OpenNext)アプリケーションです。

## できること・できないこと

- **CSV自動取込**: 燃費計算表・給与集計表・売上モニタリストの3種CSVを`/import`から取り込み、車両別収支(51列相当)を自動計算してD1に保存します(`src/infrastructure/parsers/`, `src/domain/rules/vehiclePlCalculation.ts`)。
- **手入力は5項目以内に限定**: データソースに存在しない項目(修理実費・燃料・AdBlue等)のみ`/manual-entry`で入力し、計算式には一切関与しません。
- **人の作業は確認・修正のみ**: 異常値・未入力を`/todo`で検知し、人は「修正する/承認する」を選ぶだけです。
- **赤字黒字の要因分析(LLM)**: `/report`でClaude API(`src/infrastructure/ai/ClaudeFactorAnalysisClient.ts`)が損益変動要因を日本語で解説します。判定(黒字/赤字)自体はルールベース、理由説明はLLMという役割分担です。
- **Excel(.xlsx)としての書き出しは未実装**: 出力はDB格納+画面表示のみで、既存の完成Excel(`data/`配下)からの読み込み(移行用)はありますが、逆方向の生成はありません。

## ディレクトリ構成

- `app/`: Next.js App Router(画面・API Route)。APIはRoute Handlerで実装し、Honoは使用しない
- `src/domain/`: 収支計算式・異常検知ルール
- `src/infrastructure/parsers/`: CSV/xlsxパーサー
- `src/infrastructure/ai/`: LLM要因分析クライアント
- `src/usecase/steps/`: 月次確定フローのユースケース
- `migrations/`: D1(SQLite)スキーママイグレーション
- `data/`: 分析元CSV/Excel(業務データにつき非公開)
- `docs/`: 要件定義、設計方針、プロジェクト資料
- `docs/setup-guide-remaining-tasks.md`: 実装完了後に人手で行う設定作業一覧(OAuth/APIキー/CI Secrets等)
- `tests/`: vitestによる単体・結合テスト

## 開発コマンド

```bash
npm run dev              # ローカル開発サーバー
npm run typecheck        # 型検査
npm run test             # テスト実行
npm run coverage         # カバレッジ計測
npm run db:migrate:local # D1マイグレーション(ローカル)
npm run cf:dry-run       # デプロイのドライラン
npm run deploy           # Cloudflareへデプロイ
```

## 運用上の制約

- **完成済みExcel(★車両別収支表)の取込は、収支確定(手入力・締め)より先に実行してください。**
  月次収支表(`/grid`)の「Excelとの差異」は、Excel側の値(`raw_ingestion`)とシステムの計算値(`vehicle_pl`)を突き合わせて表示します。
  この2つは同じ `vehicle_pl` テーブルに書き込むため(Excel取込は移行期間の正本として、収支確定は再計算結果として)、
  **Excel取込を後に実行した月は両者が同一値になり、差異が実際にはあっても「全N台が一致」と表示されます**(突合の空振り)。
  スキーマに書き込み元を持たせれば厳密化できますが、通常の運用順では起きないため制約として残しています。

## 改善要望を Claude Code へ渡す

管理画面の改善要望から、システム管理者の操作で **Claude Code 向けの指示文** を発行できます。
外部サービスの設定は要りません(トークンの登録も不要です)。

- 一覧で選んで「選んだものを Claude Code に渡す」、または詳細画面の「Claude Code に渡す」を押す
- 発行と同時に、その件だけを読める **期限つきの鍵** (既定7日・最長30日) が1本できる
- 画面に出る文をコピーして Claude Code に貼ると、`GET /api/instructions` を読んで直し始める

| 入口 | 役割 |
| --- | --- |
| `GET /api/instructions` | 鍵の範囲をまとめて読む。既定は Markdown、`?format=json` で構造化 |
| `GET /api/instructions/<id>` | 1件だけ読む |
| `GET /api/instructions/shot/<id>?exp=&sig=` | 画面の写し。署名と期限が合ったときだけ配る(24時間) |

守り:

- 指示文は **鍵が無ければ1件も読めない**(`Authorization: Bearer <鍵>`)。鍵は発行済みの件だけを開ける
- 鍵の平文は発行の応答1回きり。保存するのは指紋(SHA-256)だけで、管理画面には出ない
- 鍵は一覧から即時に止められる(`/admin/improvements/tokens`)。要望を完全削除すると鍵も自動で止まる
- 本文に混ざったメール・電話・カード番号・トークンらしい文字は伏せてから渡す
- 画像の署名鍵は `BETTER_AUTH_SECRET` から導くため、追加のシークレットは不要

利用者向けの手順は [Claude Code でこの改善要望を直す手順](docs/product/claude-code-improvement-guide.md) にあります。

## ドキュメント

- [詳細要件定義書](docs/requirement.md)
- [デザインシステム](docs/design-system.md)
- [分析・改善定義](docs/manifest.md)
- [残タスク実施手順書(人手設定作業)](docs/setup-guide-remaining-tasks.md)

## 取り扱い

本リポジトリには業務データと関係者情報が含まれるため、非公開で管理してください。
