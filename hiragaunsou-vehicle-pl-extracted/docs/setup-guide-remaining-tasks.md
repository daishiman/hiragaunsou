# 車両別収支管理システム：残タスク実施手順書

対象: 実装は完了済み。ここに書かれている作業はすべて**あなた(人間)にしかできない設定作業**です。
所要時間の目安: 全部で30〜40分程度。

> [!CAUTION]
> このドキュメントに出てくる Client Secret / API Token / Secret Key の類は、AI・チャット・メール・スクリーンショットへ絶対に貼り付けないでください。ターミナルへの直接入力のみで扱います。

---

## タスク一覧(この順番で進めてください)

1. Google Workspaceドメインの確定
2. Google OAuthクライアントの発行 + ログイン用シークレット登録
3. AI要因分析レポート用の`ANTHROPIC_API_KEY`登録
3.5. AI設定画面(複数プロバイダAPIキー管理)用の暗号鍵登録
4. GitHub Secretsの登録(CI/CDが動くようにする)
5. 本番URLへのスモークテスト(実際に開いて動作確認)
6. web-perf(表示速度)の計測
7. (完了)未使用パッケージ`hono`の削除

---

## タスク1: Google Workspaceドメインの確定(複数ドメイン許可リスト)

### 何をするか
このシステムは「許可された会社のGoogleアカウントでログインした人だけ」が使えるようになっています。判定に使う許可ドメイン(例: `hiragaunsou.co.jp`のような、社員のメールアドレスの`@`より後ろの部分)を設定ファイルに書き込みます。

**単一ドメインだけでなく、カンマ区切りで複数ドメインを指定できます。** 平賀運送に加えて、将来的に協力会社等のドメインを追加したくなった場合も、この節の手順で追記するだけで済みます(コード変更・再デプロイの都度アプリを作り直す必要はありません)。

### 手順
1. 平賀運送の社員が普段使っているメールアドレスを1つ確認してください(例: `yamamoto@hiragaunsou.co.jp`なら、ドメインは`hiragaunsou.co.jp`です)。
2. エディタ(VSCode等)で以下のファイルを開きます。
   ```
   /Users/dm/dev/dev/TireMind/平賀運送/hiragaunsou-vehicle-pl-extracted/wrangler.jsonc
   ```
3. `vars`の中にある、次の行を探します。
   ```jsonc
   "WORKSPACE_DOMAINS": "example.co.jp",
   ```
4. `"example.co.jp"`の部分を、実際の許可ドメインに書き換えます。例えば実際のドメインが`hiragaunsou.co.jp`なら、次のようにします。
   ```jsonc
   "WORKSPACE_DOMAINS": "hiragaunsou.co.jp",
   ```
5. **複数ドメインを許可したい場合(今すぐでなくても、将来このまま使えます)**は、カンマ区切りで追記するだけです。空白は入れても入れなくても構いません(前後の空白は自動的に無視されます)。
   ```jsonc
   "WORKSPACE_DOMAINS": "hiragaunsou.co.jp,partner-a.co.jp,partner-b.co.jp",
   ```
6. 同じファイルの`BETTER_AUTH_URL`の値が本番URLと一致しているか確認します(現状 `https://hiragaunsou-vehicle-pl.daishimanju.workers.dev` になっていればそのままでOKです)。
7. ファイルを保存します。
8. ターミナルを開き、次のコマンドでプロジェクトフォルダへ移動します。
   ```bash
   cd "/Users/dm/dev/dev/TireMind/平賀運送/hiragaunsou-vehicle-pl-extracted"
   ```
9. 変更を確認します。
   ```bash
   git diff wrangler.jsonc
   ```
10. 問題なければコミットしてpushします(pushすると、CI/CD経由で自動的にCloudflareへデプロイされます)。
    ```bash
    git add wrangler.jsonc
    git commit -m "WORKSPACE_DOMAINSを実際のドメインに設定"
    git push
    ```

これでタスク1は完了です。

### 後から協力会社等のドメインを追加したくなったら

いつでも、上記の手順3〜10を繰り返すだけで追加できます。実装側のコード変更は不要です。

1. `wrangler.jsonc`の`WORKSPACE_DOMAINS`にカンマ区切りで追加ドメインを追記する。
2. `git add wrangler.jsonc && git commit -m "WORKSPACE_DOMAINSに<会社名>のドメインを追加" && git push`
3. pushすると`main`ブランチへのマージ後にCI/CDが自動でCloudflareへ再デプロイします(`.github/workflows/hiragaunsou-vehicle-pl-deploy.yml`)。
4. 追加したドメインのGoogle Workspaceアカウントでログインできることを確認してください。既存の許可ドメインのログインには影響しません。

---

## タスク2: Google OAuthクライアントの発行 + ログイン用シークレット登録

### 何をするか
「Googleでログイン」ボタンを機能させるために、Google側にこのアプリを登録し、発行されたID/Secretをこのアプリに登録します。

### 手順

#### 2-1. Googleでログイン情報を作る

1. ブラウザで [Google Auth PlatformのClients画面](https://console.cloud.google.com/auth/clients) を、**会社のGoogleアカウント**で開きます。
2. 画面上部のプロジェクト選択メニューで、平賀運送用のGoogle Cloudプロジェクトを選びます(存在しない場合は新規作成が必要です。分からなければ社内のGoogle Workspace管理者に確認してください)。
3. 初回だけ「OAuth consent screen」の設定画面が表示されます。表示された場合は以下を入力します。
   - アプリ名: `平賀運送 車両別収支管理システム`
   - User type / Audience: `Internal`(社内限定)を選択
   - 保存します。
   - もし`Internal`が選択肢に出てこない場合は、`External`を選ばずに作業を中断し、「Internalが表示されません」とGoogle Workspace管理者に伝えてください(Workspace管理者権限がないと出ないことがあります)。
4. 画面右上あたりの`CREATE CLIENT`ボタンを押します。
5. 表示されるフォームに、以下のとおり入力します。

   | 項目 | 入力する値 |
   |---|---|
   | Application type | プルダウンから `Web application` を選択 |
   | Name | `平賀運送 車両別収支管理システム Web` と入力 |
   | Authorized JavaScript origins | 何も入力せず空欄のまま |

6. `Authorized redirect URIs`という欄の`ADD URI`ボタンを2回押して、以下の2行をそれぞれ1行ずつ貼り付けます。
   ```
   http://localhost:8787/api/auth/callback/google
   https://hiragaunsou-vehicle-pl.daishimanju.workers.dev/api/auth/callback/google
   ```
   (2行目のURLはタスク1で確認した本番URLと同じものにしてください。)
7. 一番下の`CREATE`ボタンを押します。
8. 作成完了後、`Client ID`と`Client Secret`が表示されたポップアップ(またはページ)が出ます。**この画面をまだ閉じないでください**。次の手順ですぐ使います。

#### 2-2. Terminalで登録する

1. VSCode等のエディタでこのアプリのフォルダを開きます。
   ```
   /Users/dm/dev/dev/TireMind/平賀運送/hiragaunsou-vehicle-pl-extracted
   ```
2. エディタの「ターミナル」メニューから内蔵Terminalを開きます(またはmacOSのターミナルアプリで上記フォルダへ`cd`します)。
3. 次のコマンドを1回だけ実行します。
   ```bash
   node .better-auth-google/setup-secrets.mjs
   ```
4. `Google Client IDを貼り付けてEnter`と表示されるので、手順2-1の8で表示された**Client ID**をコピーして貼り付け、Enterキーを押します。
5. 続けて`Google Client Secretを貼り付けてEnter`と表示されるので、同じ画面の**Client Secret**をコピーして貼り付け、Enterキーを押します。入力した文字は画面に表示されませんが、正常な動作です。
6. 最後に次のメッセージが出れば成功です。
   ```
   完了しました。Secretの値は表示・送信していません。
   ```
   このコマンドは自動的に、ローカル環境用の設定ファイル(`.dev.vars`)と、Cloudflare本番環境の両方に、`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `BETTER_AUTH_SECRET`(ログインセッション用の暗号鍵、自動生成)を登録します。

#### 2-3. ログインを確認する

1. ブラウザで [本番サインイン画面](https://hiragaunsou-vehicle-pl.daishimanju.workers.dev/sign-in) を開きます。
2. `Googleで続ける`ボタンを押します。
3. タスク1で設定した会社のドメイン(例: `hiragaunsou.co.jp`)の社員アカウントでログインします。
4. アプリの画面(収支表グリッド等)が開けば成功です。

もし止まった場合は、以下のいずれかのエラーメッセージが出ていないか確認し、**Secretの値は送らずに**、エラーメッセージの文言だけを控えてください。
- `Internalが表示されません`
- `CREATE CLIENTが押せません`
- `redirect_uri_mismatchが出ました`(→ 2-1の6で入力したURLが本番URLと完全一致しているか確認)
- `Terminalのコマンドでエラーが出ました`

---

## タスク3: AI要因分析レポート用の`ANTHROPIC_API_KEY`登録

### 何をするか
赤字・黒字の要因をAIが分析してレポートを出す機能(F12)は、Claude APIを使います。そのための鍵(APIキー)を1つ発行し、Cloudflareの本番環境に登録します。

### 手順

1. ブラウザで [Anthropic Console](https://console.anthropic.com/settings/keys) を開き、平賀運送で使う組織のアカウントでログインします(アカウントがなければ作成が必要です)。
2. `Create Key`のようなボタンを押します。
3. キーの名前(Name)欄に `hiragaunsou-vehicle-pl-production` のような分かりやすい名前を入力します。
4. 作成すると、`sk-ant-...`から始まる文字列が1回だけ表示されます。この画面を閉じずにコピーします(閉じると二度と表示されないため、必ずこの場でコピーしてください)。
5. ターミナルで以下のコマンドを実行します(プロジェクトフォルダにいることを確認してください)。
   ```bash
   cd "/Users/dm/dev/dev/TireMind/平賀運送/hiragaunsou-vehicle-pl-extracted"
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
6. `Enter a secret value:` のように入力を求められるので、手順4でコピーした`sk-ant-...`のキーを貼り付けてEnterキーを押します。
7. `Success! Uploaded secret ANTHROPIC_API_KEY` のようなメッセージが出れば完了です。

これでCloudflare本番環境でAI要因分析レポート機能が動作するようになります。

---

## タスク3.5: AI設定画面(複数プロバイダAPIキー管理)用の暗号鍵登録

### 何をするか
管理者(admin)向けの`/ai-settings`画面から、Claude/ChatGPT/Gemini/Grokの各APIキーをアプリのデータベース(D1)に登録・削除できます。この画面に入力したAPIキーは平文のままでは保存されず、暗号化してからD1に保存する仕組みです。その暗号化・復号に使う鍵(誰にも推測されない32byteのランダム値)を1つ発行し、Cloudflareの本番環境に登録します。

この鍵を登録し忘れると、`/ai-settings`画面でAPIキーを保存しようとした際にエラーになります(逆に言うと、`/ai-settings`画面を使わない場合はこのタスクは後回しにしても他の機能に影響しません)。

### 手順

1. ターミナルで以下のコマンドを実行し、ランダムな鍵を生成します。
   ```bash
   openssl rand -base64 32
   ```
2. 表示された文字列(`=`で終わる44文字程度の文字列)をコピーします。**この文字列はパスワードと同じ扱いです。AI・チャット・メール・スクリーンショットへ貼り付けないでください。**
3. プロジェクトフォルダで以下のコマンドを実行します。
   ```bash
   cd "/Users/dm/dev/dev/TireMind/平賀運送/hiragaunsou-vehicle-pl-extracted"
   npx wrangler secret put API_KEY_ENCRYPTION_SECRET
   ```
4. `Enter a secret value:` と表示されるので、手順2でコピーした文字列を貼り付けてEnterキーを押します。
5. `Success! Uploaded secret API_KEY_ENCRYPTION_SECRET` のようなメッセージが出れば完了です。

これで本番環境の`/ai-settings`画面からAPIキーを登録・削除できるようになります。

> [!NOTE]
> ローカル開発環境(`.dev.vars`)には、実装時点で開発用の暗号鍵をすでに設定済みです。本番環境とは別の値なので、そのままで問題ありません。

---

## タスク4: GitHub Secretsの登録(CI/CDが動くようにする)

### 何をするか
GitHub Actionsで「PRを出すと自動でテストが走る」「mainにマージすると自動でCloudflareへデプロイされる」仕組みが既に用意されています。ただし、Cloudflareへアクセスするための鍵(トークン)がまだGitHub側に登録されていないため、このままではデプロイ工程だけ失敗します。以下の2つの値をGitHubに登録します。

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### 手順

#### 4-1. Cloudflare API Tokenを発行する

1. ブラウザで [Cloudflareダッシュボードのトークン発行画面](https://dash.cloudflare.com/profile/api-tokens) を開きます。
2. `Create Token`ボタンを押します。
3. `Edit Cloudflare Workers`という名前のテンプレートを探し、その右側の`Use template`ボタンを押します(なければ`Create Custom Token`から手動で作成します)。
4. `Token name`欄に `hiragaunsou-vehicle-pl-cicd` のような名前を入力します。
5. `Permissions`欄を確認し、最低限以下が含まれるようにします(テンプレート使用時は概ね含まれています)。
   - `Account` - `Workers Scripts` - `Edit`
   - `Account` - `D1` - `Edit`
   - `Account` - `Workers R2 Storage` - `Edit`(R2バケットを使うため)
6. `Account Resources`欄で、対象のCloudflareアカウント(平賀運送のアカウント)を選択します。
7. 画面下部の`Continue to summary`→`Create Token`を押します。
8. 表示されたトークンの文字列をコピーします(この画面を閉じると二度と表示されません)。

#### 4-2. Cloudflare Account IDを確認する

1. [Cloudflareダッシュボード](https://dash.cloudflare.com) を開きます。
2. 左メニューまたはトップページ右側に表示される`Account ID`という項目の文字列をコピーします。

#### 4-3. GitHubにSecretsを登録する

1. ブラウザで https://github.com/daishiman/hiragaunsou/settings/secrets/actions を開きます(リポジトリのSettings → Secrets and variables → Actions と同じ画面です)。
2. `New repository secret`ボタンを押します。
3. `Name`欄に `CLOUDFLARE_API_TOKEN` と入力し、`Secret`欄に手順4-1でコピーしたトークンを貼り付け、`Add secret`を押します。
4. もう一度`New repository secret`を押し、`Name`欄に `CLOUDFLARE_ACCOUNT_ID` と入力し、`Secret`欄に手順4-2でコピーしたAccount IDを貼り付け、`Add secret`を押します。

#### 4-4. GitHub Environment「production」の作成(デプロイワークフローが要求するため)

デプロイ用ワークフロー(`hiragaunsou-vehicle-pl-deploy.yml`)は`environment: production`という設定になっているため、GitHub側に`production`という名前のEnvironmentを作る必要があります。

1. https://github.com/daishiman/hiragaunsou/settings/environments を開きます。
2. `New environment`ボタンを押します。
3. 名前の欄に `production` と入力し、`Configure environment`ボタンを押します。
4. 特別な保護ルール(Required reviewers等)は今回は設定不要です。そのまま何も追加せず画面を離れて問題ありません(手順4-3で登録したリポジトリレベルのSecretsが自動的に使えます)。

これで、PR #6をマージした際に自動でCloudflareへデプロイされる状態になります。

---

## タスク5: 本番URLへのスモークテスト(実際に開いて動作確認)

### 何をするか
実装エージェントの作業環境はネットワーク制限があり、実際にブラウザで本番URLを開く確認ができていません。ここは人間の手で1回だけ確認します。

### 手順
1. ブラウザで https://hiragaunsou-vehicle-pl.daishimanju.workers.dev を開きます。
2. サインイン画面が表示されることを確認します(表示されない・エラーが出る場合はスクリーンショットを控えてください)。
3. タスク2で確認したとおりGoogleでログインします。
4. ログイン後、収支表のグリッド画面が表示されることを確認します。
5. 可能であれば、CSVインポート画面(`/import`)を開き、実データ(例: `車両別運行実績表（燃費計算）本社.csv`)を1つ試しにアップロードしてみて、エラーなく取り込めるか確認します。

問題があれば、表示されたエラーメッセージとどの画面・操作で起きたかを控えて共有してください。

---

## タスク6: web-perf(表示速度)の計測

### 何をするか
ページの表示速度(Core Web Vitals)を計測します。実装エージェントの環境では専用ツール(chrome-devtools)が使えず未実施だったため、以下のいずれかの方法で確認します。

### 方法A: PageSpeed Insightsを使う(最も簡単)
1. ブラウザで https://pagespeed.web.dev/ を開きます。
2. 入力欄に `https://hiragaunsou-vehicle-pl.daishimanju.workers.dev/sign-in` と入力します(ログインが必要な画面は計測できないため、ログイン不要なサインイン画面で計測します)。
3. `Analyze`ボタンを押します。
4. 数十秒待つと、`Performance`のスコア(0〜100)と、`LCP`(Largest Contentful Paint)・`CLS`(Cumulative Layout Shift)などの指標が表示されます。
5. スコアやLCPの値をスクリーンショットまたはメモで控えてください。

### 方法B: Claude Codeでchrome-devtools MCPを使う(次回セッション向け)
1. Claude Codeの設定でchrome-devtools MCPサーバーを追加します(詳細はClaude Codeのドキュメントを参照)。
2. 追加後、次回のセッションで「本番URLのCore Web Vitalsを計測して」と依頼すれば自動計測できます。

まずは方法Aで十分です。

---

## タスク7(完了): 未使用パッケージ`hono`の削除

### 何をするか
以前のCloudflare Workers単体構成で使われていた`hono`は削除済みです。このアプリはNext.js App Router + OpenNext構成であり、APIは`app/api/`のRoute Handlerで実装します。Honoを再導入しないでください。

確認済み: `app/`、`src/`、`tests/`、`scripts/`にHonoのimportはなく、`package.json`にも依存はありません。

---

## タスク8: 改善要望を Claude Code へ渡すための設定 → **設定作業なし**

### 何をするか

**何もしなくても使えます。** 改善要望を Claude Code に渡す機能は、外部サービスの設定を必要としません。
指示文を読むための鍵は管理画面から発行し、画面の写しに使う署名鍵は既存の `BETTER_AUTH_SECRET` から
導いています(シークレットを増やすほど、登録し忘れて本番だけ落ちる箇所が増えるため)。

以前あった `GITHUB_ISSUE_TOKEN` / `GITHUB_ISSUE_REPO` / `GITHUB_ISSUE_ATTACH_SHOT` は不要になりました。
**2026-08-15 に本番を確認したところ、この3つは登録されていませんでした**
(本番にあるのは `BETTER_AUTH_SECRET` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` の3つだけ)。
そのため、消す作業は要りません。もし別の環境に登録済みなら、使われないまま残しておく理由がないので
次のコマンドで消してください。

```bash
pnpm exec wrangler secret delete GITHUB_ISSUE_TOKEN
pnpm exec wrangler secret delete GITHUB_ISSUE_REPO
pnpm exec wrangler secret delete GITHUB_ISSUE_ATTACH_SHOT
```

### 確認方法

1. 改善要望の一覧で1件に印を付け、「選んだものを Claude Code に渡す」を押す。
2. 「Claude Code に渡す文をそのまま読む」を開いて中身を確認し、「この内容で実行する」を押す。
3. 出てきた文を「コピーする」で写し、Claude Code に貼る。要望が読み込まれれば成功です。
4. 「Claude Code に渡した鍵を見る・止める」に、いま作った鍵が「使えます」で並びます。

利用者向けの手順書: `docs/product/claude-code-improvement-guide.md`

---

## 完了チェックリスト

- [ ] タスク1: `WORKSPACE_DOMAINS`を実際のドメインに変更してpush(複数ドメインはカンマ区切りで追記可)
- [ ] タスク2: Google OAuthクライアント発行 → `setup-secrets.mjs`実行 → ログイン確認
- [ ] タスク3: `ANTHROPIC_API_KEY`を`wrangler secret put`で登録
- [ ] タスク3.5: `API_KEY_ENCRYPTION_SECRET`を`wrangler secret put`で登録(`/ai-settings`画面を使う場合のみ必須)
- [ ] タスク4: GitHub Secrets(`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`)登録 + `production` Environment作成
- [ ] タスク5: 本番URLでのログイン・CSVインポートの動作確認
- [ ] タスク6: PageSpeed Insightsでの表示速度計測
- [x] タスク7: `hono`パッケージ削除
- [x] タスク8: 改善要望を Claude Code へ渡す機能は設定作業なし(不要になった `GITHUB_ISSUE_*` は登録済みなら削除)
