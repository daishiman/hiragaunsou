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
4. GitHub Secretsの登録(CI/CDが動くようにする)
5. 本番URLへのスモークテスト(実際に開いて動作確認)
6. web-perf(表示速度)の計測
7. (任意・低優先度)未使用パッケージ`hono`の削除

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

## タスク7(任意・低優先度): 未使用パッケージ`hono`の削除

### 何をするか
以前の実装(Cloudflare Workers単体構成)で使っていた`hono`というパッケージが、Next.js構成への移行後も`package.json`に残ったままになっています。実害はありませんが、次回の軽微な整理のタイミングで削除して問題ありません。

### 手順
1. ターミナルでプロジェクトフォルダへ移動します。
   ```bash
   cd "/Users/dm/dev/dev/TireMind/平賀運送/hiragaunsou-vehicle-pl-extracted"
   ```
2. 次のコマンドで、コード中に`hono`が使われていないことを再確認します(何も表示されなければ未使用です)。
   ```bash
   grep -rl "from \"hono\"\|from 'hono'" app src 2>/dev/null
   ```
3. 何も表示されなければ、アンインストールします。
   ```bash
   npm uninstall hono
   ```
4. 型検査とテストが通ることを確認します。
   ```bash
   npm run typecheck
   npm run test -- --run
   ```
5. 問題なければコミットします。
   ```bash
   git add package.json package-lock.json
   git commit -m "未使用のhono依存を削除"
   git push
   ```

---

## 完了チェックリスト

- [ ] タスク1: `WORKSPACE_DOMAINS`を実際のドメインに変更してpush(複数ドメインはカンマ区切りで追記可)
- [ ] タスク2: Google OAuthクライアント発行 → `setup-secrets.mjs`実行 → ログイン確認
- [ ] タスク3: `ANTHROPIC_API_KEY`を`wrangler secret put`で登録
- [ ] タスク4: GitHub Secrets(`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`)登録 + `production` Environment作成
- [ ] タスク5: 本番URLでのログイン・CSVインポートの動作確認
- [ ] タスク6: PageSpeed Insightsでの表示速度計測
- [ ] タスク7(任意): `hono`パッケージ削除
