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

## 改善要望のGitHub起票(任意設定)

管理画面の改善要望詳細から、システム管理者の操作でGitHub Issueを立てられます。未設定でもアプリは動き、
「Issueにする」だけが案内つきで断られます(下書きの確認は未設定でもできます)。

| 設定名 | 役割 |
| --- | --- |
| `GITHUB_ISSUE_TOKEN` | 起票用トークン。Workersのシークレットにだけ置く(コード・リポジトリには置かない) |
| `GITHUB_ISSUE_REPO` | 起票先。`owner/repo` 形式 |
| `GITHUB_ISSUE_ATTACH_SHOT` | `true` のときだけ画面の写しをIssueに貼る(既定は貼らない) |

トークンの取得先と権限:

- 推奨: <https://github.com/settings/personal-access-tokens/new> (fine-grained)
  対象リポジトリに**起票先だけ**を指定し、Repository permissions の **Issues を Read and write**。それ以外は付けない。
- 有効期限を設定した場合、**期限切れで起票が止まります**(下書きの確認は続けられます)。
- 代替: <https://github.com/settings/tokens/new?scopes=repo> (classic token, repo スコープ)。権限が広くなるため fine-grained を推奨。
- 画面の写しも貼る場合のみ、Contents を Read and write に足したうえで `GITHUB_ISSUE_ATTACH_SHOT=true` を設定します。

```bash
pnpm exec wrangler secret put GITHUB_ISSUE_TOKEN   # 登録後は画面にも出ません
```

## ドキュメント

- [詳細要件定義書](docs/requirement.md)
- [デザインシステム](docs/design-system.md)
- [分析・改善定義](docs/manifest.md)
- [残タスク実施手順書(人手設定作業)](docs/setup-guide-remaining-tasks.md)

## 取り扱い

本リポジトリには業務データと関係者情報が含まれるため、非公開で管理してください。
