# AI開発エージェントキット セットアップマニュアル【Windows版】

**バージョン 1.10.4**

## このキットは何?

Claude Code と OpenAI Codex に、**プロの開発ノウハウ集(共通スキル20個)** と **開発を最初から最後まで自動で進める司令塔(エージェント)** を同時に追加するキットです。

インストールすると、Claude Code では

> /build-app 社員の勤怠を管理するアプリを作って

Codex では

> $build-app 社員の勤怠を管理するアプリを作って

と一言頼むだけで、要件の整理 → デザイン → 開発 → 公開 → 品質チェックまでを、決められた手順で自動的に進めてくれるようになります。

公開した後は、Claude Code なら `/improve-app`、Codex なら `$improve-app` に続けて要望を書きます。

> /improve-app 月ごとの集計をグラフでも見たい

と頼むだけで、今あるアプリを壊さずに機能を1つずつ追加・改善していけます。

> **Codexにもagent／subagentがあります。** Claude Code のcustom `/command` に対応する標準導線はCodexでは `$skill` です。`/skills` や `/agent` などCodex組み込みのslash commandとは別物です。また、`AGENTS.md` はプロジェクト規約を毎回読み込む常設指示で、必要なときだけ起動するskillやcustom agentの代わりではありません。

> **CodexのAIDD配置は2種類です。** `SKILL.md` は `.agents\skills\<名前>\`、custom agentの `.toml` は `.codex\agents\` に置きます。projectの`.codex\skills`は使いません。`%CODEX_HOME%\skills`（通常`%USERPROFILE%\.codex\skills`）はCodex組込installer/plugin等のpersonal installed領域で、AIDDは書き込みません。

**所要時間: 約5分。難しい操作はありません。**

---

## 事前に必要なもの

| 必要なもの | 確認方法 |
|---|---|
| Claude Code または OpenAI Codex がインストールされた Windows PC | どちらかのアプリでチャットが使える |
| 利用するツールへのサインイン | Claude Code または Codex を開いてチャットが使える状態になっている |

> インストーラーは `.claude`、`.agents\skills`、`.codex` に両方の設定を用意します。片方だけを現在使っている場合でも実行できます。

---

## STEP 1: ZIPファイルを展開する

1. 受け取った `aidd-agent-kit.zip` を **右クリック** し、**「すべて展開…」** を選びます。
2. 「展開」ボタンをクリックします。
3. `aidd-agent-kit` というフォルダができるので、開きます。

> ZIPをダブルクリックして「中を見ているだけ」の状態では、インストールできません。必ず「すべて展開」してからにしてください。

## STEP 2: インストーラーをダブルクリックする

1. フォルダの中の **`install-windows.bat`** をダブルクリックします。
   - ファイル名が `install-windows` とだけ表示されている場合もあります(同じものです)。
2. 黒い画面が開き、自動でインストールが進みます。
3. **「インストールが完了しました!」** と表示されたら成功です。何かキーを押して画面を閉じてください。

> **「WindowsによってPCが保護されました」という青い画面が出たら**
>
> 1. 画面の中の **「詳細情報」** をクリックします。
> 2. 右下に現れる **「実行」** ボタンをクリックします。
>
> これは「配布元がMicrosoftに登録されていないファイル」に必ず出る標準の確認画面で、このキットに問題があるわけではありません。

### コマンドプロンプトでコマンド実行してインストールする方法(上級者向け)

ダブルクリックの代わりに、コマンドプロンプトから実行することもできます。挙動はダブルクリックと同じです。

```
cd aidd-agent-kit フォルダのパス
install-windows.bat
```

通常インストーラーが書くのはuser scopeの `.claude`、`.agents\skills`、`%CODEX_HOME%`(未設定なら `.codex`)です。Codex公式の探索範囲にはproject scopeの `.agents\skills`・`.codex\agents` もありますが、同名Skillはuser/project間で統合されません。このキットをプロジェクト限定で使う場合は手動コピーではなく、キットを含むリポジトリのルートから `call aidd-agent-kit\sync-project-windows.bat` を使い、project scopeを明示してください。同じAIDDキットの二重導入は非推奨です。

配置だけ診断する場合は、Git BashまたはWSLで対象リポジトリのルートから `./aidd-agent-kit/doctor-codex-layout.sh` を実行します。診断はファイルを削除・移動しません。同内容の重複は警告、内容差やproject `.codex\skills` はNGです。

Codexの旧 `/prompts:build-app` 形式は非推奨で、標準インストールには含まれません。既存運用との移行期間だけ必要な場合は、任意の `--legacy-prompts` を付けます。新しい利用方法では `$build-app` を使ってください。

```
install-windows.bat --legacy-prompts
```

## STEP 3: 開発環境を準備する(初回のみ)

アプリ開発には **Node.js** と **pnpm** という2つの道具が必要です。付属のスクリプトで両方まとめて入ります。

1. フォルダの中の **`setup-env-windows.bat`** をダブルクリックします。
   - ファイル名が `setup-env-windows` とだけ表示されている場合もあります(同じものです)。
2. 黒い画面が開き、自動でインストールが進みます(2〜5分)。
3. **「セットアップが完了しました!」** と表示されたら成功です。

このスクリプトでは、あわせて **Claude Code / Codex と Cloudflare(アプリの公開先)の連携設定(MCP: AI開発ツールと外部サービスをつなぐ仕組み)** も自動で行われます。初回に利用するとき、ブラウザで許可を求める画面が開くことがありますが、**「許可」を押していただければ大丈夫**です。

> すでに入っている場合は「インストール済みです」と表示されるだけなので、何度実行しても問題ありません。
> 「WindowsによってPCが保護されました」という青い画面が出たときは、STEP 2 と同じ方法(詳細情報 → 実行)で開いてください。

## STEP 4: 動作確認する

1. Claude Code と Codex を **一度終了して、起動し直します**。
2. Claude Code は **`/build-app`**、Codex は **`$build-app`** と入力します。
3. 入力候補に **build-app** が表示されればインストール成功です。Codex では `/skills` からも確認できます。

---

## 使い方

### 基本の使い方

Claude Code は `/build-app`、Codex は `$build-app` に続けて、作りたいものを普通の言葉で書くだけです。

```
Claude Code: /build-app 会議室の予約アプリ。社員だけが使える。Googleアカウントでログイン。
Codex: $build-app 会議室の予約アプリ。社員だけが使える。Googleアカウントでログイン。
```

### 上手に頼むコツ

次の3点を書くと、AIが迷わず一発で作ってくれます。

1. **誰が使うか**(例: 社員だけ / 取引先も / 誰でも)
2. **何ができるか**(例: 予約できる、一覧が見られる、承認できる)
3. **公開範囲**(例: 社内限定 / ログインが必要 / 一般公開)

### 公開した後に育てるとき

最初のアプリを公開した後は、Claude Code の `/improve-app` または Codex の `$improve-app` に続けて要望を書きます。

```
Claude Code: /improve-app 車両ごとの一覧を印刷しやすいレイアウトでも見たい
Codex: $improve-app 車両ごとの一覧を印刷しやすいレイアウトでも見たい
```

- 要望を書かずに `/improve-app` または `$improve-app` だけ入力すると、**残課題リスト(次にやることの候補一覧)**から選べます。
- 複数の要望があっても、**1件ずつ**安全に追加されます(今動いているアプリを壊さないためです)。
- 変更内容は自動で記録されます。問題があったときは Claude Code の **`/undo-app`** または Codex の **`$undo-app`** で、**1つ前の状態に戻せます**。

```
Claude Code: /undo-app さっき追加した印刷レイアウトをいったん取り消したい
Codex: $undo-app さっき追加した印刷レイアウトをいったん取り消したい
```

### コマンドを使わなくてもOK

普通に「在庫管理のアプリを作りたい」と話しかけるだけでもスキルは起動できます。確実に動かしたいときは Claude Code の `/build-app` または Codex の `$build-app` を使ってください。

---

## うまくいかないとき

### Q1. インストーラーがどうしても開けない

**手動でコピーする方法**があります。

1. エクスプローラー(フォルダのアイコン)を開きます。
2. 上部の **アドレスバー** をクリックし、次のとおり入力して Enter を押します。

   ```
   %USERPROFILE%\.claude
   ```

3. Claude Code 用の `skills`・`agents`・`commands` を `.claude` の対応するフォルダへコピーします。
4. Codex 用は、共通 `skills` と `codex\workflow-skills` を `.agents\skills`、`codex\agents` を `.codex\agents` へコピーします。さらに `agents\app-orchestrator.md` を `.agents\skills\app-orchestrator\SKILL.md`、`codex\app-orchestrator-openai.yaml` を `.agents\skills\app-orchestrator\agents\openai.yaml` として配置します。非推奨の旧互換が必要な場合だけ `codex\prompts` を `.codex\prompts` へコピーします。

### Q2. `/build-app` または `$build-app` が候補に出てこない

- 利用中の Claude Code / Codex を**完全に終了**して起動し直してください。
- 新しいチャット(新しいセッション)を開いてから入力してください。

### Q3. 「インストールを確認できませんでした」と表示された

画面に**入らなかったものの一覧**が表示されます。その内容を控えたうえで、次をお試しください。

- ZIPを展開してできた `aidd-agent-kit` フォルダの**中の** `install-windows.bat` を実行しているか確認してください(ZIPの中から直接実行すると失敗します)。
- 解決しない場合は Q1 の手動コピーをお試しください。

### Q4. Codex でスキルが表示されない

1. Codex を完全に終了して起動し直します。
2. 新しいチャットで `/skills` を開き、`build-app` を確認します。
3. 見つからない場合は `%USERPROFILE%\.agents\skills\build-app\SKILL.md` があるか確認します。
4. AIDDのSkillは `%USERPROFILE%\.agents\skills` を確認します。`%CODEX_HOME%\skills` はCodex組込installer/plugin等の管理領域なので、AIDDのファイルを手動で追加・移動しないでください。

### Q5. `.codex\agents` と `.toml` は何に使う?

`.codex\agents\app-orchestrator.toml` は、Codexが仕事を委譲するcustom agentの定義です。スキルの置き場所ではありません。`name`・`description`・`developer_instructions` を持つTOMLをここへ置き、実際の作業手順は `.agents\skills\app-orchestrator\SKILL.md` から読みます。

### Q5-1. userとprojectの両方に同じAIDDスキルがある

Codexは同名Skillを自動統合しないため、二重導入は推奨しません。`./aidd-agent-kit/doctor-codex-layout.sh` で非破壊診断し、表示されたmanifestを確認して、どちらのscopeを使うか決めてください。doctorは自動削除しません。なお、`%CODEX_HOME%\skills` はCodex組込installer/plugin等の管理領域なので、存在するだけで誤配置ではありません。

### Q6. 「別の場所への『近道(リンク)』になっています」と表示された

Claude Code または Codex の書き込み先が、別の場所を指すリンクとして設定されています。リンク先を意図せず書き換えないため、インストーラーが停止しました。

心当たりがない場合は、**この画面のまま導入支援の担当者にお見せください**。

ご自身で設定された方は、画面に表示されたコマンドでリンクを一時的に退避してから、もう一度インストーラーを実行してください。

### Q7. 「以前のファイルは次の場所に保存してあります」と表示された

Claude Code または Codex に同じ名前の項目があったため、**上書き前に自動でバックアップ**したという意味です。インストール自体は成功しています。

```
C:\Users\(あなたの名前)\.claude\backup-20260726-143000\
C:\Users\(あなたの名前)\.codex\backup-20260726-143000\
```

元に戻したいときは、このフォルダの中身を元の場所へ戻してください。不要になったら、フォルダごと削除して構いません。

### Q8. 「ファイルのコピー中に問題が発生しました」と表示された

- ディスクの空き容量を確認してください(50MB程度必要です)。
- ウイルス対策ソフトがコピーを止めている場合があります。一時的に停止できないか、社内のIT担当者にご相談ください。
- 解決しない場合は Q1 の手動コピーをお試しください。

### Q9. 黒い画面の日本語が文字化けしている

- 表示が崩れていてもインストール自体は正常に行われます。STEP 4 で `/build-app` または `$build-app` が出れば問題ありません。

### Q10. セットアップスクリプトが「インストールに失敗しました」と表示する

社内ネットワークの通信制限(必要なファイルのダウンロード先がブロックされている)が原因の場合があります。

**この画面を閉じずに、そのまま社内のIT担当者・導入支援の担当者にお見せください。** どの通信が止められているかが画面に出ているため、担当者側で対応できます。

---

## インストールされるものの一覧

Claude Code 用は `.claude`、Codex のスキルは `.agents\skills`、Codex のcustom agentは `.codex\agents` に入ります。このキットが入れていない項目には触れません。

> **同じ名前のファイルがあった場合のみ**、そのファイルは上書きされます。ただし上書き前に `backup-(日時)` フォルダへ自動で退避されるので、元に戻せます。

### エージェント(司令塔) — 1個

| 名前 | 役割 |
|---|---|
| app-orchestrator | 要件整理→デザイン→開発→公開→品質チェックを順番に進める司令塔 |

Codexでは `app-orchestrator.toml` をcustom agentとして利用し、同じ手順を内部Skill `$app-orchestrator` として配置します。利用者は `$build-app` / `$improve-app` を入口にしてください。内部Skillは明示的な委譲またはfallbackでだけ使われ、一般の依頼から暗黙起動しません。

### コマンドワークフロー — 4個

| 名前 | 役割 |
|---|---|
| `/build-app` / `$build-app` | 新しいアプリを最初から公開まで作る |
| `/improve-app` / `$improve-app` | 公開済みのアプリに機能追加・改善を1件ずつ行う |
| `/undo-app` / `$undo-app` | 直前の変更を取り消して、アプリを1つ前の状態に戻す |
| `/setup-cicd` / `$setup-cicd` | チーム用Cloudflare設定、秘密値の安全な登録、自動チェック・自動公開をまとめて導入する |

Codex では `$...` のスキル形式を使ってください。非推奨の `/prompts:build-app` などは標準では入らず、`--legacy-prompts` を指定した場合だけ旧互換として入ります。

### 共通スキル(開発ノウハウ集) — 20個

| 名前 | 内容 |
|---|---|
| app-excellence | アプリ開発全体の進め方・品質基準 |
| mvp-first-development | まず必要な機能一式で公開し、残課題を管理しながら育てる進め方 |
| jp-web-design | 日本語アプリのデザインルール |
| ux-design | 使いやすさ(UX)の設計ルール |
| cloudflare-secure-deploy | 安全にインターネット公開する手順 |
| launch-security | 公開前のセキュリティ・品質検査 |
| testing-excellence | テストの進め方 |
| better-auth-google-gate | Googleログイン・アクセス制限の作り方 |
| llm-api-integration | AI機能(読み取り・分類など)の組み込み方 |
| workers-best-practices | サーバープログラムの品質ルール |
| wrangler | 公開ツールの正しい使い方 |
| durable-objects | リアルタイム機能(チャット等)の作り方 |
| cloudflare | Cloudflare(公開基盤)の総合知識 |
| web-perf | 表示速度の計測・改善 |
| llm-cost-simulator | AI機能の利用料金の試算 |
| turnstile-spin | 問い合わせフォームのボット対策 |
| cloudflare-email-service | メール送信機能の作り方 |
| solo-git-flow | 個人開発の変更管理(ブランチ・プルリク・Issue)の進め方 |
| ci-cd-pipeline | 非エンジニア向けCloudflare設定票と1コマンド登録、自動チェック・自動公開の作り方 |
| design-judgment | テンプレート感を業務構造の反映不足として診断・改善する判断基準 |

---

## 更新するとき

新しいバージョンを受け取ったら、**STEP 1 から同じ手順を繰り返すだけ**です。古いファイルは自動でバックアップされてから置き換わり、**後から入れた新しいキットの内容が常に正**になります。

- 新しいキットで**なくなった古いスキルやコマンドは、自動で整理**されます(バックアップフォルダへ移動します)。片付けのためにご自身で何かを削除する必要はありません。
- 整理の対象は**このキットが入れたものだけ**です。ご自身で追加されたスキルやコマンドには触れません。
- 使いながら貯まったノウハウ(ナレッジ)は**消えません**。そのまま引き継がれます。

更新後は Claude Code と Codex を再起動してください。

## アンインストールしたいとき

エクスプローラーで `.claude`、`.agents\skills`、`.codex` を開き、次のキット項目だけを削除します。

1. `.claude\skills` と `.agents\skills` の中の、**上の表にある20個のフォルダ**
2. `.claude\agents\app-orchestrator.md` と `.agents\skills\app-orchestrator`
3. `.claude\commands` の4ファイルと `.agents\skills` の4コマンドスキル
4. `.codex\agents\app-orchestrator.toml`。`--legacy-prompts` を使った場合だけ `.codex\prompts` の4ファイル
5. `.claude` と `.codex` の **`aidd-agent-kit.version`** / **`aidd-agent-kit.manifest`**

> `skills`・`agents`・`commands` フォルダ自体は削除しないでください。Claude Code が使う他のファイルが入っている場合があります。

インストール時に作られた `backup-(日時)` フォルダが残っている場合、その中に元のファイルが入っています。必要なら戻したうえで、フォルダごと削除してください。

---

## 管理者の方へ(セットアップ後の運用に必要なもの)

エージェントがアプリを**インターネットに公開する**ところまで自動で行うため、利用する環境によって以下が必要です。非エンジニアの方は、導入支援の担当者にご相談ください。

- **Claude Code または OpenAI Codex を利用できるプラン**
- **Cloudflare アカウント**(アプリの公開先。無料プランで開始可能)と `wrangler login` によるログイン
- **GitHub アカウント**(アプリの変更履歴の保存先。**プライベートリポジトリ**=自社の関係者だけが見られる保管場所を使用します)
- **GitHub CLI (`gh`)** のインストールと `gh auth login` によるサインイン。プルリクエストの作成・確認・反映はGitHub MCPではなく `gh` を使います
- **Cloudflare との連携設定(MCP)**。付属のセットアップスクリプトがClaude Code／Codexの両方へ自動で設定します(STEP 3)
- Googleログイン機能を使う場合: **Google Cloud** の OAuth 設定(手順はスキル内に日本語で収録済み)
- AI機能を使う場合: **OpenAI / Anthropic 等の APIキー**
