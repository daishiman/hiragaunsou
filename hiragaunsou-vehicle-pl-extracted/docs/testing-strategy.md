# テスト戦略

## テストピラミッドと役割分担

| レイヤー | ツール | 対象 | 環境 |
| --- | --- | --- | --- |
| 単体テスト | Vitest | `src/domain/**`, `src/usecase/**`, `app/_lib/**` | Node |
| API/統合テスト | Vitest | `app/api/**/route.ts`(D1・認証・外部APIはモック) | Node |
| インフラ層テスト | Vitest + better-sqlite3 | `src/infrastructure/db/**`, `src/infrastructure/ai/**` 等 | Node |
| UIコンポーネントテスト | Vitest + React Testing Library | `app/_components/**`, `app/(app)/**` のクライアントコンポーネント | jsdom |
| E2E/UXテスト | Playwright | 実ブラウザでの画面遷移(現状: 未ログイン時のアクセス制御のみ) | Chromium |

コンポーネントテストは、ファイル先頭に `/** @vitest-environment jsdom */` を書くことで
そのファイルだけjsdom環境になる(それ以外はNode環境がデフォルト)。`tests/setup/testingLibrary.ts`
で `@testing-library/jest-dom` のmatcherと `afterEach(cleanup)` を全体に適用している。

## E2E(Playwright)の現状の範囲と制約

このアプリのほぼ全画面はGoogle Workspaceアカウントでのログインが必須(`better-auth-google-gate`)。
本番と分離したテスト専用の認証バイパスを用意していない現状では、ログイン後の画面まで実ブラウザで
自動検証することはできない。そのため `tests/e2e/` は「未ログイン時のリダイレクト」「サインイン画面の
表示・エラー文言」というUXの土台部分に限定している。

ログイン後の画面までE2E対象を広げる場合は、以下のいずれかを別途合意した上で導入する:
- CI/ローカルE2E専用のテスト用Google Workspaceアカウントを用意し、実OAuthフローを流す
- 本番コードには含めない、テスト実行時のみ有効な署名済みセッションCookie発行の仕組みを追加する

## E2Eが「実装は正しいのに落ちる」3つの型と、その塞ぎ方

実際にCIで3件同時に落ちた。3件とも画面は正しく動いており、落ちたのはテストの書き方が原因だった。
同じ形で落ちないよう、対策はすべてヘルパー1箇所に寄せてある。

| 落ち方 | なぜ落ちるか | 塞ぎ方 |
| --- | --- | --- |
| 画面名を変えたら落ちる | 見出しの文言を spec に書き写していた。「収支表のチェック」→「チェック(…)」と改めた瞬間に赤くなる | `tests/e2e/helpers/screenNames.ts` の `screenHeading("/anomaly")`。呼び名は `app/_lib/screens.ts` から引く |
| 畳んだメニューの中を見に行けず落ちる | 使用頻度の低い画面はサイドバー下部のアカウントメニューに畳んだ。閉じている間はDOMに無い | `tests/e2e/helpers/accountMenu.ts` の `openAccountMenu()`。「出ないこと」を見るときも必ず開いてから確かめる(開かずに `toHaveCount(0)` を書くと、権限で消えているのか畳まれているだけなのか区別できず素通りする) |
| 打った値が消えて落ちる | 表が描き終わる前に金額欄を掴むと、直後の描き直しで打った値が捨てられる | `tests/e2e/helpers/manualEntry.ts` の `filterToVehicle()`。画面に出ている「表示 N台 / 全 M台」で描画の完了を待つ |

### ローカルD1の同時書き込み

E2EはCIで **1本ずつ** 流す(`playwright.config.ts` の `workers: process.env.CI ? 1 : undefined`)。
ローカルD1(miniflare)は1つのSQLiteファイルで、同時に書き込むと `SQLITE_BUSY: database is locked` を返す。
ファイル内の `test.describe.configure({ mode: "serial" })` は順番を決めるだけで、**ファイル同士の同時実行**は止められない。
本番のD1は同時書き込みを捌けるので、これはローカル実行環境だけの制約。

それでも取りこぼす一瞬の競合は `tests/e2e/helpers/testUsers.ts` の `withBusyRetry` が待って作り直す。
better-auth を経由すると元の `SQLITE_BUSY` はログに出るだけで `APIError: Failed to create user` に化けるため、
この文言と、原因(`cause`)を根まで辿った文字列も再試行の対象に含めている。

## カバレッジ基準

`vitest.config.ts` の `coverage.thresholds` で statements / branches / functions / lines を
すべて80%に設定している。`npm run coverage` がこの閾値を下回ると非ゼロ終了する。

対象(`coverage.include`)は次の層を含む:
`src/domain/**`, `src/usecase/**`, `src/infrastructure/**`, `app/api/**/route.ts`,
`app/_components/**/*.tsx`, `app/_lib/**`, `app/(app)/**/*.tsx`。

閾値はプロジェクト全体に対するグローバル基準であり、ファイル単位の個別基準は設けていない
(1ファイルが80%未満でも、全体で80%を満たしていればゲートは通る)。

## 「無理やり通す」テストを防ぐための方針

- モックの戻り値をそのままアサートするだけの、実装ロジックを検証しないテストは書かない。
  権限チェック・CSRF・バリデーション・境界値・エラーハンドリングなど、実際の分岐を通すこと。
- カバレッジの行を通すためだけの `expect(true).toBe(true)` 相当のテストは禁止。
- テストを通すために実装コード側を書き換えることは原則行わない。実装に疑問があれば、
  テストを歪めずに問題として報告する。
- 新規追加したテストはコードレビュー時に「この分岐/境界値が本当に意味のある検証か」を確認する。

## ローカルGitフック(pre-commit / pre-push)

コミット前とプッシュ前で役割を分けている(高速フィードバックと、共有前の最終ゲートの両立):

- **pre-commit**: ステージ済みファイルに対する `eslint --fix`(lint-staged)のみ。数秒で終わる。
- **pre-push**: `npm run typecheck` と `npm run coverage`(80%閾値込みの全テスト)。
  重いが、GitHub上のCIで落ちて手戻りするより先にローカルで検知する。

このリポジトリは `hiragaunsou-vehicle-pl-extracted/` を含むモノレポ(gitルートは1階層上)。
`.husky/pre-commit` と `.husky/pre-push` はステージ/差分にこのディレクトリ配下のファイルが
含まれる場合のみ実行し、他プロジェクトの変更では何もしない。

有効化には `git config core.hooksPath .husky`(リポジトリルートで実行済み)が必要。
新しく clone した開発者は初回に一度だけ実行すること。

## CI/CD

`.github/workflows/hiragaunsou-vehicle-pl-ci.yml`(PR時)と
`hiragaunsou-vehicle-pl-deploy.yml`(main push時)は、対象パスに
`hiragaunsou-vehicle-pl-extracted/**` の変更があるときだけ走るモノレポ対応の設定になっている。
特定ファイルをハードコードしていないため、このディレクトリ配下のソース変更には自動的に追従する。

CIでは lint → typecheck → coverage閾値付きテスト → Cloudflareビルド → 依存脆弱性監査 →
E2Eスモークテストの順に実行する。Deployワークフローも同様のゲートを通過してから
D1マイグレーション適用・デプロイ・稼働確認を行う。
