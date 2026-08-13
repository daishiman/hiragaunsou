---
name: jp-web-design
description: 日本語Webアプリ・LPの移植可能なデザインシステム。画面が「AIっぽい」「テンプレート感がある」と指摘された場合は、色・トークンの調整に入る前に Skill `design-judgment` を先に使う。既定のMode AはGraphite × Amberで、グラファイトをCTA・選択・骨格、アンバーを実行中などの状態専用に限定し、AIを特別色で飾らない。Light/Dark/OS自動追従、テーマ永続化、IBM Plex Sans + JetBrains Mono、サイドバー→アイコンレール→下部タブの適用判断、safe-area、44px操作領域、hover/pressed/入場/展開/処理中の意味ある短いモーション、reduced-motion、色以外の状態表現を含む。画面は情報設計の工程8ステップと6判断軸から導出し、UXは Skill `ux-design` を併用する。UIの新規設計・実装・レビュー・リニューアルで必ず参照する。
---

# 日本語Web UI デザインシステム

実プロジェクトの反復フィードバックから確立した規範。装飾を足して良く見せるのではなく、**余白・面・文字の階層**で秩序を作る。色は「意味」にしか使わない。

- Mode Aの色値は共有された **Graphite × Amberの正本**。明示的なブランド要件がある場合だけ差し替え、**役割の割り当ては変えない**。
- 迷ったら「色を足す」ではなく「余白と階層で解く」。
- 何をデフォルトにするか・一括操作・エラー回復などの**体験設計は Skill `ux-design`** を参照(UXの規律は下記どちらのモードでも共通)。
- 画面が「生成AIやテンプレートで作ったように見える」「AIっぽい」と指摘された場合は、色・トークンの調整に入る前に **Skill `design-judgment`** で業務構造の反映不足を診断する(本書とux-designはその判断の後工程)。
- 本書は中核ルールだけを載せる。**詳細は §6 のリファレンス索引から必要なファイルを読む**(作業前に該当ファイルを必ず開く)。

## 起動プロトコル — 質問より先に代表画面を作る

UIの新規設計・リニューアルでは、依頼文・既存画面・業務フロー・ブランド資産を調べ、次を内部で確定する。**質問より先に、最頻業務を表す完成度の高い代表画面を1つ作る。** 複数の無難な案は並べず、最有力案を正本として実装する。

1. **カラー契約**: 指定がなければ Mode A のGraphite × Amberを使う。企業カラーの明示指定がある場合だけ `references/color-system.md` のブランド上書き手順を使う。
2. **ロゴ・アイコン素材**: 既存のロゴ/アプリアイコンはあるか? あればヘッダー・faviconへ使用し、明示的なブランド要件がある場合だけprimary候補を抽出する。なければテキストロゴで開始(ロゴの自作はしない)。
3. **デザインモード**(下記から1つ):
   - **A. Graphite × Amber / ミニマル・信頼**(既定) — 業務システム・開発者ツール・金融・レポート・管理画面向け。Light/Dark対応、グラファイトを骨格、アンバーを動作中の状態専用にする。`references/mode-a-graphite-amber.md` を必ず読む。
   - **B. Pop・親しみ** — toC ツール・コンシューマー向け。色の面を大胆に使い、丸く・太く・遊びを1つ入れる。`references/mode-b-pop.md` 参照。
4. **テーマ**: Mode Aの既定は自動 + Light/Dark手動切替。OS自動追従だけ、ライト固定など明示要件があれば記録する。Mode Bは既定ライト。

未指定項目は上記既定で進め、判断と却下した主要候補をT2へ残す。ロゴ原本、法的ブランド制約、公開前承認など本人しか決められない境界があっても、テキストロゴやローカルpreviewで成果物を先に作り、差し替え箇所だけを依頼者へ示す。

## 0. 8秒でわかる原則

0. **順序が結果を決める — 表から書き始めない**。場面の1文 → ラベル剥がし → **伝わらないものだけ最小限に補う** → グループ化 → 優先順位 → 表示用加工 → 表示形式の導出 → 機能と意味づけの装飾。設計とデザインを分けず、この8工程で作る(`references/information-design.md`)。**装飾を後から足しても画面は良くならない。**
1. **色は役割で固定する** — Mode Aはグラファイト=操作と骨格、アンバー=実行中の状態だけ。主要CTA・AI機能の装飾・キー数字にアンバーを使わない。
2. **Light/Darkを別々に設計する** — Mode Aは背景・面・境界の3段階を両テーマで保ち、機械反転しない。Mode BのDarkは明示要件がある場合だけ別途設計する。
3. **メリハリ: 1画面に視覚的主役を1つ** — 全部同じサイズ・太さの画面は視線の行き場がない。「まずここ」を大きく、それ以外は静かに。
4. **マニュアル不要** — 押せるものは押せる見た目、押せないものに押せる見た目を与えない。初見で最頻タスクが完了できるか。
5. **折返しを設計する** — 単語・数字・チップの「途中折返し」「1文字/1個だけ折返し」を全ブレークポイントで禁止。
6. **数字はExcel基準でシャープに** — 単位は列ヘッダー、セルは生数値+カンマ。数字は欧文フォントで描画する。
7. **動きは因果の説明だけ** — 装飾のためのアニメーションを足さない。`reduced-motion` で全部止まる。
8. **数字はすべて本物** — 演出のための偽の数字・煽り・偽の緊急性を使わない。
9. **AIを通常機能として描く** — 紫・ネオン・専用グラデーションを割り当てず、他画面と同じ情報階層・ボタン・状態表現を使う。

## 1. Mode Aの中核トークン

```css
:root, html[data-theme="light"] {
  color-scheme: light;
  --primary: #232326; --primary-hover: #3a3a3f; --primary-text: #ffffff;
  --bg: #f1f1ef; --surface: #ffffff; --surface-alt: #e9e9e6;
  --text: #141417; --text-muted: #5c5c62;
  --border: #d9d9d5; --border-strong: #c4c4bf;
  --accent: #b45309; --accent-text: #ffffff;
  --success: #166534; --success-bg: #ddefe3;
  --warning: #92580a; --warning-bg: #f3e8d3;
  --danger: #b91c1c; --danger-bg: #f6e2e0;
  --neutral: #52525b; --neutral-bg: #e6e6e3;
  --page-bg: #e2e2df; --focus-ring: #232326;
  --font-ui: "IBM Plex Sans", "Hiragino Sans", "Yu Gothic", sans-serif;
  --font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
  --font-num: "IBM Plex Sans", "SF Pro Text", "Segoe UI", sans-serif;
  --tap: 44px;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
}
```

Dark値・OS自動追従・テーマ永続化・safe-area・コンポーネント契約は **`references/mode-a-graphite-amber.md`** を正本とする。

### 導入手順(Tailwind v4)

1. `globals.css` の先頭に `@import "tailwindcss";`。
2. 上のトークンと、`references/motion-a11y.md` のモーション・フォーカスCSSをコピー。
3. `@theme inline` でユーティリティに橋渡し:

```css
@theme inline {
  --color-primary: var(--primary); --color-primary-hover: var(--primary-hover); --color-primary-text: var(--primary-text);
  --color-bg: var(--bg); --color-surface: var(--surface); --color-surface-alt: var(--surface-alt);
  --color-text: var(--text); --color-text-muted: var(--text-muted);
  --color-border: var(--border); --color-border-strong: var(--border-strong);
  --color-accent: var(--accent); --color-success: var(--success); --color-warning: var(--warning);
  --color-danger: var(--danger); --color-neutral: var(--neutral);
}
```

4. `[hidden] { display: none !important; }` を必ず入れる(`display: flex/grid` のユーティリティが `hidden` 属性を上書きする事故を防ぐ)。

## 2. カラー規律 — Graphite + 状態色(最重要)

| 比率 | 役割 | 使う色 |
|---|---|---|
| 60% | 地・背景・カード | page-bg / bg / surface / surface-alt |
| 30% | 文字・罫線・区切り | text / text-muted / border |
| 10% | 操作と状態 | primary(操作) + accent/semantic(状態だけ) |

- **primary** は主要CTA・操作・選択・リンク・現在地。装飾に使わない。
- **accent** は実行中・処理中・ヒアリング中だけ。主要CTA・キー数字・AI専用色にしない。
- success / warning / danger / neutral は意味がある状態だけ。彩り目的で増やさず、文言とborderを必ず併用する。
- Darkは `bg / surface / surface-alt / border` の明度差を個別設計し、黒一色や自動反転にしない。
- **カード左端の色帯(カテゴリ/ステータスのアクセントボーダー・インセットストライプ)は禁止**(特定案件の発注者フィードバックに基づく本プロジェクトの恒久ルール、2026-07。他プロジェクトでは要件次第で見直し可)。分類・状態の色はチップ/ドット/進捗バーの塗りで示し、カードの縁には一切色を付けない。
- 状態の塗り分けはバッジの「塗り・罫線・打消し線」の違いで表現し、色相を増やさない。
- **原色・蛍光色をそのまま使わない**。ブランド上書き時も彩度を一段落として採用する。
- 明示的にブランド色へ上書きするときも、accentの状態専用という役割を変えない。

> Mode Aの全トークンと実装契約は `references/mode-a-graphite-amber.md`、企業カラー指定時の例外手順は `references/color-system.md`。

## 3. 中核の寸法表(毎回参照する3つ)

### 3-1. タイポグラフィ階層(主役:本文 = 2.5倍以上)

| 用途 | サイズ | 太さ |
|---|---|---|
| ページ主数字(結果)= 主役 | `text-4xl`〜`5xl`(36〜44px) | bold・text・`--font-num` |
| ページタイトル | `text-lg`〜`xl`(18〜20px) | bold |
| セクション見出し | `text-sm`(13px) | 太字だが小さく静かに |
| 本文 | `text-sm`(14px) | normal |
| 補足・ラベル | 12px(SPは13px推奨)`text-ink-muted` | normal |

> 見出しを「大きく・色付き」で目立たせない。主役は中身(数字・事実)。主役の作り方・説明文を視覚要素に置き換える手順は `references/typography-numerals.md`。

### 3-2. レスポンシブ4段(この4幅で実測してから完成とする)

| 呼称 | 幅 | コンテナ | 検証幅 |
|---|---|---|---|
| SP | 〜639px | 全幅・padding 16〜20px | **375px** |
| タブレット | 640〜1023px | 全幅・padding 24px | **768px** |
| PC | 1024〜1439px | `max-w-5xl`(1024px)中央 | **1280px** |
| ワイド | 1440px〜 | `max-w-6xl`(1152px)中央・**それ以上広げない** | **1600px** |

- ブレークポイントはTailwind既定(`sm:640 / md:768 / lg:1024 / xl:1280`)に合わせ、独自の中途半端な値を作らない。
- 部品の折返し・列切替・カード化は `@container`(コンテナクエリ)で書き、メディアクエリはページ骨格だけに使う。
- SPは「小さくする」のではなく「減らす」(テーブル→カード化・折りたたみ・上位N件)。詳細は `references/layout-responsive.md`。

### 3-3. 数値のCSS(数字は必ず欧文フォントで描く)

```css
.num { font-family: var(--font-num); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; white-space: nowrap; }
.num-display { font-family: var(--font-num); font-variant-numeric: tabular-nums; letter-spacing: -0.015em; font-weight: 700; }
.num-sep  { font-size: 0.8em; font-weight: 400; }                                        /* 大型数字のカンマは脇役に */
.currency { font-size: 62%; font-weight: 600; margin-right: 0.15em; letter-spacing: 0; } /* 通貨記号は単位扱い */
```

表記規則(Excel基準・単位は列ヘッダー・KPIは正確な値)と「濃く太い数字=変わる値」の文法は `references/typography-numerals.md`。

## 4. 絶対ルール要約(モード共通・違反したら作り直す)

- **表から書き始めない**。情報設計の工程(`references/information-design.md` §2)を通してからマークアップに入る。**表示形式は6つの判断軸から導出する**(同 §5)。結果として表を選ぶのは可だが、選定理由と却下候補を1行で言えること。
- **前例のない要件を「対応不可」にしない**。同 §9 の手順(原理に還元 → 軸で測る → 慣習を探す → 実データで検証 → 判断を記録)で導く。通常の表示形式・ラベル・加工・画像の判断は標準の `docs/product/T2-experience-spec.md`(プロジェクトに同等責務の既存正本がある場合はその正本)に残し、**前例のない例外だけ** `docs/product/design-decisions.md` に分離する。
- **DBの生値(ISO日時・コード値・真偽値・内部ID)を画面にそのまま出さない**(突合・出力・入力欄は例外で生値が正)。
- **画像は役割を判定してから置く**。識別・証拠・説明の画像は目的に応じて強調し、装飾だけなら原則削除する。採用時は alt・キャプション・トリミング・4幅(375/768/1280/1600px)を設計と検収の対象にする(`references/information-design.md` §4-1)。
- **群の境界は余白で作る**。罫線・背景色・囲みを足す前に余白を倍にする。ゼブラ・表ヘッダーのベタ塗り・分類ごとの色分けは使わない。
- Mode AのDarkは正本トークンから実装し、Lightの機械反転や黒一色の面を作らない。Mode BのDarkは勝手に追加しない。
- accentは実行中などの状態専用。主要CTA・キー数字・AI専用装飾に流用しない。カード左端の色帯は禁止。
- 1画面に視覚的主役を1つ。主役:本文のサイズ比2.5倍以上。同格要素のサイズは揃える。
- 本文・補足は**12px未満にしない**。補足文は1行(全角25〜30字)以内。
- 数字は `--font-num`(欧文)+ `tabular-nums`。テーブルは生数値+カンマ、単位は列ヘッダー、1列1単位。
- 「濃く太い数字=変わる値」の文法を全画面で統一する(値=太く濃い / ラベル・単位=小さくmuted)。
- 「1文字だけ改行」「1個だけ折返し」「途中折返し」を 375/768/1280/1600px の4幅すべてで出さない。ページ全体の横スクロール禁止。
- **語の途中で折り返さないことが既定**。`word-break: break-all` をはみ出し対策として全体に当てない(はみ出す長い連続文字だけ `overflow-wrap: anywhere`)。短いラベル・ボタン文言・表ヘッダーは折り返さず、収まらないなら文言を短くするか省略表示にする。単位・記号を行頭行末に孤立させない。
- 頭文字アイコン(丸や四角に漢字1字)・多色アイコン・絵文字・自作SVGアイコンは禁止。迷ったらアイコンなし。
- 押せないものに押せる見た目(hover効果・`cursor: pointer`)を与えない。アイコン単独ボタンを作らない。
- すべてのアニメーションは `prefers-reduced-motion: reduce` で止まる。バウンス・オーバーシュートは使わない。
- フォーカスは必ず可視化(`:focus-visible` に2pxアウトライン)。タップ領域44px。状態を色だけで伝えない。
- 表示する数字はすべて本物の計算結果。偽の緊急性・煽り・confirmshaming 禁止。

## 5. リファレンス実装(`assets/reference/` — 発注者検収済み)

**本スキルの全規律を実装した「動く正解」がコードで保存されている。UIを実装するときは必ず開いて流用する(記憶で似せて書かない)。**

- `assets/reference/README.md` — ファイルマップと**React/TypeScriptへの移植ルール**(クラス→コンポーネント対応表つき)。まずこれを読む。
- `styles.css` = トークンと全部品のCSS(単一の真実)/ `index.html` + `app.js` = モードAの画面構造とvanillaロジック / `pop.html` = モードBの全ディテール / `catalog.html` = 部品カタログ
- マスコット: `assets/pop-mascot-editable.svg`(原本)+ `reference/mascot-bordered.svg` / `mascot-borderless.svg`(再着色例)
- React/TSの状態ロジック(下書き・一括選択・送信キー・並行処理等)は **Skill `ux-design` の `assets/ux-patterns.tsx`** を使う。
- Mode Aのtoken変更後は `node scripts/check-mode-a-contrast.mjs` を実行し、Light/Darkの本文・muted・primary・全状態色が4.5:1以上であることを確認する。これはaxe等の画面全体検査を置き換えない。
- どのフレームワークでも: Mode Aは `references/mode-a-graphite-amber.md`、Mode Bは `references/mode-b-pop.md`、ブランド例外は `references/color-system.md` を使う。移植後も検収(4幅実測+動的パス操作)を必ず通す。

## 6. リファレンス索引(`references/` — 作業内容に応じて読む)

| ファイル | 読むタイミング | 内容 |
|---|---|---|
| `references/information-design.md` | **画面を設計する前(必読)**・既存画面の改善指示を受けたとき・「見づらい/ダサい」の指摘時・**本書に前例がない要件のとき** | 情報設計の工程8ステップ、「設計→装飾」の順で作った画面の6症状、ラベル剥がしの原則、表示用データ加工の原則、**表示形式の導出(6判断軸→導出ルール→合成/分割/新規採用→検証)**、配置の4原則、既存画面のリライト手順、**前例がない要件への適用手順(自己拡張)** |
| `references/mode-a-graphite-amber.md` | **Mode Aを選んだとき(必読)**・Light/Dark・テーマ・アプリシェル・状態色を実装するとき | Graphite × Amberの正本トークン、アンバー状態専用契約、テーマ永続化、safe-area、サイドバー/下部タブの選択、a11y |
| `references/color-system.md` | 明示的な企業カラーへ上書きする・配色レビュー | 変えてよいtoken/不変の役割、Light/Dark調整、面階層、記録と検証 |
| `references/typography-numerals.md` | 文字・数字を扱う全作業 | メリハリ(主役の作り方・サイズ表)、補足文の規律、Excel基準の数値表記CSS、値/ラベルの描き分け、アフォーダンス、**折返しプロパティの使い分け表と禁則**、UXライティング |
| `references/layout-responsive.md` | 画面骨格・レスポンシブ対応 | アプリシェル、余白・角丸、4段ブレークポイント表、モバイル情報削減、コンテナクエリ第一、結果/レポート画面の情報階層、**固定ヘッダー・固定フッター** |
| `references/components.md` | 部品を作る・レビューする | ボタン/フォーム/バッジ/テーブル/選択バー/モーダル/トースト/空状態のHTML、アイコン方針、スライダー座標系、バーチャートの3条件 |
| `references/motion-a11y.md` | アニメーション・hover・展開・a11y実装 | hover/pressed/入場/モーダル/展開/処理中/状態更新の時間表とCSS、操作感、reduced-motion、フォーカス・コントラスト・タップ領域 |
| `references/mode-b-pop.md` | モードBを選んだとき(必読) | パステル変換表、Pop用トークン、迷いゼロの構造、かわいらしさの作法、マスコット使用ルール |
| `references/acceptance-checklist.md` | 実装完了前の検収 | 21項目の検収チェックリスト(4幅実測・動的パス操作を含む) |

体験面(デフォルト・一括操作・正直なUI・エラー回復)の検収は Skill `ux-design` のチェックリストを併用する。
