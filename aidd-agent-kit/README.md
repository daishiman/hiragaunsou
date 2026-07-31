# AI開発エージェントキット

**バージョン 1.1.0**

Claude Code に「プロの開発ノウハウ集(スキル16個)」と「開発を自動で進める司令塔(エージェント app-orchestrator)」を追加するキットです。

インストールすると、Claude Code に次のように頼むだけで、要件の整理からデザイン・開発・公開・品質チェックまでを決められた手順で自動的に進めてくれるようになります。

```
/build-app 社員の勤怠を管理するアプリを作って
```

## まずマニュアルをお読みください

お使いのパソコンに合わせて、どちらかのマニュアルをダブルクリックで開いてください。

| お使いのPC | マニュアル(見やすい版) | マニュアル(テキスト版) | インストーラー |
|---|---|---|---|
| Mac | `manual-mac.html` | `manual-mac.md` | `install-mac.command` |
| Windows | `manual-windows.html` | `manual-windows.md` | `install-windows.bat` |

## 事前に必要なもの

- **Claude Code** がインストール済みで、サインインが完了していること
  - まだの場合は先に Claude Code を起動し、チャットが使える状態にしてください
  - `~/.claude` フォルダが存在しないと、インストーラーは処理を中断します

## インストールの流れ(3ステップ・約5分)

1. このZIPを **展開する**(ZIPの中身を直接開いたままでは失敗します)
2. インストーラーをダブルクリックする
3. Claude Code を再起動して `/build-app` と入力できれば完了

詳しい手順・つまずいたときの対処は、上のマニュアルに全部書いてあります。

## インストール先

すべて、お使いのユーザーフォルダ内の `.claude` に入ります。

| OS | 場所 |
|---|---|
| Mac | `~/.claude/` |
| Windows | `C:\Users\(あなたの名前)\.claude\` |

```
.claude/
├── skills/      ← スキル16個を追加
├── agents/      ← app-orchestrator.md を追加
└── commands/    ← build-app.md を追加
```

Claude Code の設定ファイルや、他のアプリには影響しません。

### 既に同じ名前のファイルがある場合

インストーラーが**自動でバックアップを作ってから**上書きします。

```
.claude/backup-20260726-143000/   ← 上書き前のファイルがここに残る
```

元に戻したいときは、このフォルダの中身を元の場所へ戻してください。

### 注意: `.claude` の中にリンクを設定している方へ

`skills` `agents` `commands` のいずれかを**シンボリックリンク(別フォルダへの近道)**にしている場合、インストーラーは**処理を中断します**。リンク先の無関係なフォルダを書き換えてしまわないための安全装置です。

その場合は画面の案内に従い、リンクを一時退避してから再実行してください。

## 収録内容

### エージェント(司令塔) — 1個

| 名前 | 役割 |
|---|---|
| app-orchestrator | 要件整理→デザイン→開発→公開→品質チェックを順番に進める司令塔 |

### コマンド — 1個

| 名前 | 役割 |
|---|---|
| `/build-app` | 司令塔を一発で呼び出すコマンド |

### スキル(開発ノウハウ集) — 16個

| 名前 | 内容 |
|---|---|
| app-excellence | アプリ開発全体の進め方・品質基準 |
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

## 更新するとき

新しいバージョンのZIPを展開し、**同じようにインストーラーを実行するだけ**です。古いファイルは自動でバックアップされてから置き換わります。

## アンインストールするとき

`.claude` フォルダから次を削除してください。

- `skills/` の中の、上の表にある16フォルダ
- `agents/app-orchestrator.md`
- `commands/build-app.md`

インストール時に作られた `backup-YYYYMMDD-HHMMSS/` フォルダに元のファイルが残っている場合は、そこから戻せます。不要になったバックアップフォルダは削除して構いません。

## フォルダ構成

```
aidd-agent-kit/
├── README.md                ← このファイル
├── manual-mac.html          ← Mac用マニュアル(ブラウザで開く)
├── manual-mac.md            ← Mac用マニュアル(テキスト)
├── manual-windows.html      ← Windows用マニュアル(ブラウザで開く)
├── manual-windows.md        ← Windows用マニュアル(テキスト)
├── install-mac.command      ← Mac用インストーラー
├── install-windows.bat      ← Windows用インストーラー
├── skills/                  ← スキル16個(開発ノウハウ集)
├── agents/                  ← エージェント(app-orchestrator)
└── commands/                ← コマンド(/build-app)
```

## 変更履歴

### 1.1.0

- インストーラーが `.claude` 内のシンボリックリンクを検出して中断するようになりました(リンク先の別フォルダを壊さないため)
- 既存ファイルと衝突する場合、自動でバックアップを作成するようになりました
- インストール結果を全16スキル分検証するようになりました(従来は1個のみ確認)
- Claude Code 未起動で `.claude` が無い場合に、明確な案内を出すようになりました
- Windows版でコピー失敗を検知するようになりました

### 1.0.0

- 初版

---

株式会社TierMind
