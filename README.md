# AI開発エージェントキット

Claude Code に「プロの開発ノウハウ集(スキル16個)」と「開発を自動で進める司令塔(エージェント app-orchestrator)」を追加するキットです。

## まずマニュアルをお読みください

お使いのパソコンに合わせて、どちらかのマニュアルをダブルクリックで開いてください。

| お使いのPC | マニュアル(見やすい版) | マニュアル(テキスト版) | インストーラー |
|---|---|---|---|
| Mac | `manual-mac.html` | `manual-mac.md` | `install-mac.command` |
| Windows | `manual-windows.html` | `manual-windows.md` | `install-windows.bat` |

## インストールの流れ(3ステップ・約5分)

1. このZIPを展開する
2. インストーラーをダブルクリックする
3. Claude Code を再起動して `/build-app` と入力できれば完了

詳しい手順・つまずいたときの対処は、上のマニュアルに全部書いてあります。

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

---

株式会社TierMind
