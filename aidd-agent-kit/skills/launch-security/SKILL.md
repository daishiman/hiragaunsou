---
name: launch-security
description: >
  アプリの本番品質を保証する統合スキル。セキュリティ監査・例外/エラー処理設計・攻撃別対処・
  サーバーコスト最適化・パフォーマンス最適化を1つのゲートで検査する。
  「セキュリティチェックして」「リリースしていい？」「本番公開前の確認」「脆弱性診断」「監査して」
  「エラー処理を設計して」「例外処理を入れて」「攻撃対策」「レート制限」「コストを抑えたい」
  「無料枠に収めたい」「パフォーマンス改善」「重い」などの文脈で必ず使用する。
  また、認証・ユーザー入力・API・決済・機密データを扱うコードを書いた直後、およびデプロイ前には
  ユーザーが明示しなくても本スキルの該当セクションを適用する。
  デプロイ手順自体は Skill cloudflare-secure-deploy、認証実装は Skill better-auth-google-gate、
  LLMコストは Skill llm-api-integration / llm-cost-simulator を併用する。
---

# Launch Security — 本番品質ゲート（セキュリティ・例外処理・コスト・パフォーマンス）

リリース前に「攻撃に耐えるか」「壊れたとき正しく振る舞うか」「請求とクォータが破綻しないか」「速いか」の4軸を一度に検査する。MCP/CLI経由でClaude Codeが自律実装する場面でも、この基準を実装時から満たすこと。

## 使い方（2モード）

- **実装時モード**: 認証・入力処理・API・DBを書くとき、該当セクションの基準を最初から満たして書く。後付け監査で直すより安い。
- **監査モード**: リリース前・大きな変更後に、下記の監査プロセスを全部実行して GO / NO-GO を判定する。

## 監査プロセス

### Phase 1: 偵察（構成把握）

プロジェクトを分析して適用範囲を決める:
テックスタック / 認証方式 / API構成 / デプロイ先（Workers・Pages・Vercel等）/ DB（D1・Supabase等）/
ファイルアップロード有無 / 決済有無 / LLM API利用有無。

### Phase 2: 自動スキャン

`references/scan-commands.md` のgrep/auditコマンド群を並列実行する（secrets検出、SQLi、XSS、コマンドインジェクション、認証/セッション、依存脆弱性、セキュリティヘッダー、ファイルアップロード、API保護、DB、ソースマップ、オープンリダイレクト）。

並列エージェントを使う場合の分担: ①secrets+injection ②フロント+API ③インフラ+依存関係。
security-reviewer / code-reviewer / database-reviewer エージェントを併用してよい。

### Phase 3: 4軸チェックリスト

#### A. セキュリティ

- [ ] ハードコードされたSecretなし（環境変数+Wrangler Secrets。`.dev.vars`/`.env`はGit除外）
- [ ] 全ユーザー入力をzodで検証（クライアントとサーバー両方。サーバーが正）
- [ ] SQLはprepared statementのみ（D1: `prepare().bind()`）
- [ ] 認証・認可はサーバー側で毎回検証（詳細は Skill better-auth-google-gate の不変条件）
- [ ] XSS対策（dangerouslySetInnerHTMLはsanitize必須）+ セキュリティヘッダー（CSP/HSTS/X-Frame-Options/X-Content-Type-Options/Referrer-Policy）
- [ ] CSRF保護有効・状態変更はPOST/PUT/DELETE
- [ ] 認証・公開フォーム・コスト発生エンドポイントにレート制限（公開フォームはTurnstile検討 → Skill turnstile-spin）
- [ ] CORSは明示的な許可オリジンリスト
- [ ] ファイルアップロードは型・サイズ検証+R2キー正規化
- [ ] `npm audit` のhigh/criticalゼロ（または対処方針を文書化）
- [ ] インフラ・CI/CD・WAFは `references/cloud-infrastructure-security.md`

#### B. 例外処理・エラー設計・攻撃対処

`references/error-handling-and-resilience.md` を適用する:

- [ ] グローバルエラーハンドラ設置（未捕捉例外→500+相関ID。スタックトレース非公開）
- [ ] 401/403/400/404/429/500 の出し分けと情報漏えい防止
- [ ] ミドルウェア標準順序（CORS→ヘッダー→サイズ上限→レート制限→認証→認可→検証→ハンドラ）
- [ ] 攻撃別対処表の該当項目をすべて実装（SQLi/XSS/CSRF/SSRF/IDOR/ブルートフォース/DoS/パストラバーサル）
- [ ] 外部API: タイムアウト+指数バックオフ+リトライ上限
- [ ] 削除は論理削除基本。べき等性が必要な操作は重複実行防止
- [ ] ログにSecret・トークン・個人情報を出さない

#### C. サーバーコスト

`references/cost-and-performance.md` §1 を適用する:

- [ ] Workers/D1無料枠の見積り（DAU×リクエスト数×クエリ数がクォータに収まる）
- [ ] ポーリング・無限リトライ・毎リクエスト書き込みなし
- [ ] 一覧APIにLIMIT+ページネーション、`SELECT *`なし、インデックスあり
- [ ] LLM API利用時はモデル選定とコスト試算済み（Skill llm-api-integration / llm-cost-simulator）

#### D. パフォーマンス

`references/cost-and-performance.md` §2 を適用する:

- [ ] キャッシュ戦略（静的アセット/CDN/KV/D1の階層）が設計されている
- [ ] N+1なし・重い集計は事前計算
- [ ] 初期バンドル最小化・画像最適化・スケルトン表示
- [ ] リリース前にCore Web Vitals実測（Skill web-perf）でLCP 2.5s以内

### Phase 4: レポート

```text
## 本番品質監査レポート
Project / Tech Stack / Date

### CRITICAL（リリースブロック）   … file:line付き
### HIGH（リリース前に修正推奨）
### MEDIUM（リリース後1スプリント内）
### LOW（ベストプラクティス）
### PASS（確認済み項目）

Summary: 件数と内訳
Launch readiness: GO / CONDITIONAL / NO-GO
```

**Severity基準**
- CRITICAL: ハードコードSecret、SQLi、認証欠落、.env流出、認可バイパス、クォータ即死する設計
- HIGH: XSS、CSRF欠落、レート制限なし、localStorageトークン、high/critical CVE、スタックトレース公開
- MEDIUM: ヘッダー不足、過剰CORS、一部入力未検証、ソースマップ公開、N+1
- LOW: Referrer-Policy欠落、監査ログなし、CSP微調整

**判定**: GO = Critical 0 + High 0 ／ CONDITIONAL = Critical 0 + Highに対処計画あり ／ NO-GO = Critical残存

各CRITICAL/HIGHには「リスク・該当箇所・修正コード例・参照標準（OWASP等）」を添える。

## 関連スキル

| 場面 | スキル |
|---|---|
| デプロイ手順・wrangler・migration | cloudflare-secure-deploy |
| 認証・認可の実装と不変条件 | better-auth-google-gate |
| LLM APIのコスト・キー管理 | llm-api-integration / llm-cost-simulator |
| Core Web Vitals実測 | web-perf |
| Bot対策 | turnstile-spin |
| リリース前テスト全般 | testing-excellence |
