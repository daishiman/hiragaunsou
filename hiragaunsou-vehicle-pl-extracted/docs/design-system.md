# デザインシステム — 信頼のためのミニマル設計

どのアプリにもそのまま移植できる、日本企業向けの「静かで信頼できる」デザインの土台。
装飾を足して良く見せるのではなく、**余白・罫線・文字**だけで秩序を作る。色は「意味」にしか使わない。

> このドキュメントは規範（守るべきルール）です。迷ったら「色を足す」ではなく「余白と階層で解く」を選ぶ。

---

## 0. 5秒でわかる原則

1. **色数を絞る** — 画面の90%は白・グレー・黒の文字。色は操作と結果にだけ。
2. **黒背景パネルを作らない** — 強調は色ではなく、余白・罫線・文字サイズで。
3. **折返しを設計する** — 単語・数字・チップの「途中折返し」「1個だけ折返し」を禁止する。
4. **動きは因果の説明だけ** — 装飾のためのアニメーションを足さない。`reduced-motion`で全部止まる。
5. **数字はすべて本物** — 演出のための偽の数字・煽り・偽の緊急性を使わない。

この5つを破らなければ、たいていのUIは「信頼できる」見え方になる。

---

## 1. カラー — 60-30-10（最重要）

| 比率 | 役割 | 使う色 |
|---|---|---|
| **60%** | 地・背景・カード | 白 / 極薄グレー |
| **30%** | 文字・罫線・区切り | 黒に近いグレー / 薄いグレー罫線 |
| **10%** | 操作と結果 | ブランド青（操作）+ アクセント（CTAとキー数字だけ） |

### ルール（禁則）

- **ブランド（青系）**は「操作・選択状態・リンク・進捗」**のみ**。装飾に使わない。
- **アクセント（オレンジ系）**は **主要CTAボタン + 結果のキー数字の2箇所だけ**。3箇所目が欲しくなったら設計が間違っている。
- 緑=成功・黄=注意などのステータス色を「彩り」として増やさない。**1画面の色相は3つまで**。
- **黒・ダーク背景のパネルは禁止**（ヒーロー/結果カードを黒地にしない）。
- 絵文字・素人っぽい自作SVGアイコンは使わない。番号（01/02/03）とタイポグラフィで構成する。

### トークン（実績のある初期値）

```css
:root {
  /* 操作・選択・リンク・進捗 */
  --brand: #1d63be;        /* blue-600 */
  --brand-deep: #15498f;
  --brand-soft: #eef4fc;

  /* CTA + キー数字だけ（この2用途以外に使わない） */
  --accent: #e8590c;
  --accent-deep: #c74e0b;

  /* テキストと構造（画面の90%） */
  --ink: #16191d;          /* 本文 */
  --ink-muted: #545e6b;    /* 補足・ラベル */
  --line: #e3e6ea;         /* 罫線・境界 */
  --subtle: #f5f6f8;       /* 極薄の面 */

  /* 意味を持つ状態色（彩りではなく機能） */
  --danger: #d93025;       /* エラーのみ */
  --caution-soft: #fdf6e3; /* 注意の面 */
  --caution-border: #e6c96a;
}

body {
  /* 白カードを立たせるための極薄グレー地（60-30-10の「60」） */
  background: #f6f7f9;
  color: var(--ink);
  font-feature-settings: "palt"; /* 日本語の詰め */
}
```

ブランドを別の色に振り替えるとき（企業カラー適用）も、**役割の割り当て（操作=1色 / CTA・キー数字=1色）は変えない**。色相の数だけを守れば信頼感は保たれる。

---

## 2. タイポグラフィと日本語組版

### スケール（用途ベース・むやみに種類を増やさない）

| 用途 | サイズ | 太さ |
|---|---|---|
| ページ主数字（結果） | `text-4xl`〜`5xl` | bold・アクセント色 |
| セクション見出し | `text-sm font-bold` | 太字・inkだが小さく |
| 本文 | `text-sm` | normal |
| 補足・ラベル | `text-xs text-ink-muted` | normal |

> 見出しを「大きく・色付き」にして目立たせない。日本企業のUIでは**見出しは小さく静かに**、主役は中身（数字・事実）。

### 折返し・整列の禁則

- 見出しは `text-wrap: balance`。分断しやすい語は**文節単位で** `<span class="inline-block">評価</span>` にして「評/価」の分割を防ぐ。
- **数値は必ず** `tabular-nums` + `whitespace-nowrap`（下の `.tnum`）。「3億7,116万/円」の途中折返しは禁止。
- 狭い場所では概数に切り替える：「2億3,048万円」→「約2.3億円」。
- **チップ・ボタン群の「1個だけ折返し（孤児）」を禁止**。flex-wrapの成り行きに任せず等幅グリッドで：
  - 4個 = `grid-cols-2 sm:grid-cols-4` / 5個 = `grid-cols-3 sm:grid-cols-5` / 6個 = `grid-cols-3 sm:grid-cols-6`
  - 2択は `grid-cols-2` で横幅いっぱい等幅（3列に置いて左に寄せない）。
- ラベルは列幅に収まる短さに書き直す（「330㎡以内（約100坪）」→「330㎡以内」、補足は説明文へ）。
- JSX内の改行はスペースになる。日本語の連続文は `{'…'}` で1つの文字列にする。

```css
.tnum {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
```

---

## 3. レイアウトと間隔

- **面の重ね方**：極薄グレー地（`#f6f7f9`）の上に**白カード**（`bg-white border border-line`）を置く。影に頼らず罫線で分ける。
- **角丸**：カード `rounded-xl` / コントロール・小要素 `rounded-md`。混在させず用途で固定する。
- **内側余白**：カード `p-5` / 行 `px-4 py-3` を基準に。詰めすぎない。
- **区切り**：セクション内の列挙は背景色ではなく `border-b border-line` の細罫線で分ける（最後の行は `last:border-b-0`）。
- **定義リスト**：`grid grid-cols-[8rem_1fr]` でラベル列を固定幅に。値は左揃えで縦のラインを通す。

影（`shadow`）はモーダルなど「浮いている」ことに意味がある要素だけ。通常のカードに影を付けない。

---

## 4. コンポーネント（コピペで移植できる最小セット）

すべて上のトークン前提。Tailwindのクラス名は役割どおりに読める。

### ボタン

```html
<!-- 主要CTA（画面に基本1つ。アクセント色はこことキー数字だけ） -->
<button class="pressable rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white
               hover:bg-accent-deep disabled:opacity-50">送信する</button>

<!-- セカンダリ（操作=ブランド色の罫線ボタン） -->
<button class="pressable rounded-md border border-brand px-4 py-2 text-sm font-semibold
               text-brand-deep hover:bg-brand-soft disabled:opacity-50">編集</button>

<!-- 三次（静かな操作） -->
<button class="pressable rounded-md border border-line bg-white px-4 py-2 text-sm
               text-ink hover:bg-subtle">キャンセル</button>
```

- ラベルは**動詞で終える**（「送信する」「保存する」）。「〜させていただく」禁止。
- `.pressable` で押下フィードバック（`active:scale(0.98)`）。

### カード

このアプリ内では **`.card` クラス**（`app/globals.css`）を使う。角丸・罫線・白背景・`min-width:0` が
1箇所にまとまっており、`rounded-xl border border-line bg-white` と書き並べるのは禁止
（見た目は同じでも、はみ出し対策の `min-width:0` が抜けるため）。

```html
<section class="card p-5">
```

移植先で `.card` が無い場合の等価な素の指定：

```html
<section class="rounded-xl border border-line bg-white p-5">
  <div class="mb-4 flex items-baseline justify-between gap-3">
    <h2 class="text-sm font-bold text-ink">セクション見出し</h2>
    <!-- 右肩の補助操作/件数など -->
  </div>
  <!-- 中身 -->
</section>
```

### 定義行（ラベル + 値）

```html
<div class="grid grid-cols-[8rem_1fr] items-baseline gap-2 border-b border-line py-2 text-sm last:border-b-0">
  <dt class="text-xs text-ink-muted">評価額</dt>
  <dd class="text-ink"><span class="tnum">2,300万円</span></dd>
</div>
```

### ステータスバッジ（色相を増やさず塗り/罫線で区別）

状態を色で塗り分けたくなるが我慢する。**塗り・罫線・打消し線の違い**で区別すると色相が増えない。

```html
<span class="inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium bg-brand-soft text-brand-deep border-transparent">進行中</span>
<span class="... bg-subtle text-ink border-line">成約</span>
<span class="... bg-subtle text-ink-muted border-line line-through decoration-1">売却済</span>
<span class="... bg-white text-ink-muted border-line border-dashed">取下げ</span>
```

### 空状態（EmptyState）

```html
<div class="rounded-lg border border-dashed border-line px-6 py-12 text-center">
  <p class="text-sm font-semibold text-ink">まだ登録がありません</p>
  <p class="mt-1 text-sm text-ink-muted">最初の1件を追加すると、ここに一覧が表示されます。</p>
  <div class="mt-4"><!-- 主要アクション --></div>
</div>
```

### スケルトン（読み込み中）

```html
<div class="skeleton h-10 w-full"></div>
```

### 注意の面（機能としての色）

```html
<div class="rounded-md border border-caution-border bg-caution-soft px-4 py-3 text-xs leading-relaxed">
  この操作は取り消せません。内容をご確認ください。
</div>
```

---

## 5. モーション（控えめ・因果の説明のみ）

すべて `prefers-reduced-motion: reduce` で無効化する。装飾のための動きは足さない。

| 用途 | 実装 | 時間 |
|---|---|---|
| 画面/質問の遷移 | 方向つきスライド（`--dir: 1/-1` で進む/戻る） | 出150ms / 入260ms |
| カード・選択肢の入場 | `rise-in`（fade + translateY(10px)）+ `--stagger` で1枚40〜70ms刻み | 260ms |
| 選択フィードバック | チェックの `pop-in`（scale 0.4→1） | 180ms |
| 押下 | `.pressable`（`active:scale(0.98)`） | 100ms |
| 進捗・数値 | バーの width transition / カウントアップ（rAF + ease-out） | 300〜900ms |

```css
@keyframes rise-in { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform: translateY(0); } }
.rise-in { animation: rise-in 260ms cubic-bezier(0.2,0,0,1) both; animation-delay: var(--stagger, 0ms); }

@keyframes pop-in { from { opacity:0; transform: scale(0.4); } to { opacity:1; transform: scale(1); } }
.pop-in { animation: pop-in 180ms cubic-bezier(0.2,0,0,1) both; }

.pressable { transition: transform 100ms; }
.pressable:active { transform: scale(0.98); }

@keyframes pulse-soft { 0%,100% { opacity:1; } 50% { opacity:.45; } }
.skeleton { background: var(--subtle); border-radius: 6px; animation: pulse-soft 1.4s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .rise-in, .pop-in, .skeleton { animation: none; }
  .pressable, .pressable:active { transition: none; transform: none; }
}
```

選択 → 自動送りは「ハイライトを一拍（約160ms）見せてから」遷移する。

---

## 6. アクセシビリティ

- **キーボードフォーカスを必ず可視化**（`:focus-visible` に2pxのブランド色アウトライン）。
- コントラスト：本文は `--ink`、補足は `--ink-muted` まで。それより薄いグレーを本文に使わない。
- タップ領域は最低44px相当を確保。
- 装飾要素（スケルトン等）は `aria-hidden`。
- 状態を色だけで伝えない（バッジは文字ラベルも持つ）。

```css
:where(a, button, input, select, textarea, summary):focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
  border-radius: 4px;
}
```

---

## 7. 結果・レポート画面の情報階層

**白・余白・罫線で階層を作る。カードの色分け・背景色に頼らない。**

1. **主数字** — 小さいグレーのラベル + 大きな数字（ページで唯一のアクセント色）。装飾なしで中央に。
2. **前提ストリップ** — 上下の細罫線だけの3カラム（脇役として静かに）。
3. **事実カード** — ユーザーが次に知りたいこと（実際の額・期限）を白カードで。
4. **比較バー** — 現状（グレー）vs 改善後（ブランド色）。**バーには必ずラベルと数値を付ける**（裸の棒は意味不明）。
5. **CTA**（アクセント色・全幅）。
6. **根拠の開示**（折りたたみ）+ 免責。

各ブロックは `rise-in` + stagger で上から順に現れる。

---

## 8. UXライティング

- 比喩・話し言葉・キャッチーな造語を避け、**誰が読んでも同じ意味になる直接表現**にする。
- 専門用語は生活の言葉に言い換える（内部計算では正確な用語を使う）。
- ボタンは動詞で終える。1文50字以内。「〜させていただく」禁止。
- **表示する数字はすべて実際の計算結果**。偽の緊急性・煽り・confirmshaming（罪悪感を煽る選択肢）禁止。

---

## 9. 新規アプリへの導入手順（Tailwind v4）

1. `globals.css` の先頭に `@import "tailwindcss";` を置く。
2. 上の **§1 のトークン**（`:root`）と **§5・§6 のCSS**（`.rise-in` / `.pop-in` / `.pressable` / `.skeleton` / `.tnum` / `:focus-visible`）をコピーする。
3. トークンをTailwindのユーティリティとして使えるよう `@theme inline` に橋渡しする：

```css
@theme inline {
  --color-brand: var(--brand);
  --color-brand-deep: var(--brand-deep);
  --color-brand-soft: var(--brand-soft);
  --color-accent: var(--accent);
  --color-accent-deep: var(--accent-deep);
  --color-ink: var(--ink);
  --color-ink-muted: var(--ink-muted);
  --color-line: var(--line);
  --color-subtle: var(--subtle);
  --color-danger: var(--danger);
  --color-caution-soft: var(--caution-soft);
  --color-caution-border: var(--caution-border);
}
```

4. 企業カラーを当てる場合は `--brand` / `--accent` の**値だけ**差し替える。役割（操作=1色 / CTA・キー数字=1色）は変えない。
5. §4のコンポーネントをそのまま貼って肉付けする。

---

## 10. レビュー時の検収チェックリスト

- [ ] 画面内のアクセント色は2箇所以下か（CTA + キー数字）。
- [ ] 黒/ダーク背景のパネルを作っていないか。
- [ ] 色相は1画面3つ以下か（青=操作 / アクセント / 状態色）。
- [ ] 375px / 768px / 1280px で「1個だけ折返し」「単語の途中折返し」「数字の途中折返し」がないか。
- [ ] 数値に `tabular-nums` + `whitespace-nowrap` が付いているか。
- [ ] すべてのアニメーションが `reduced-motion` で止まるか。
- [ ] キーボードフォーカスが可視化されているか。
- [ ] 比喩コピー・自作アイコン・絵文字が混入していないか。
- [ ] バー・グラフに裸の図形がないか（ラベル + 数値必須）。
- [ ] 表示している数字はすべて本物の計算結果か。
- [ ] 画面ごとに書いた見出し・説明・カード指定が無いか（§11の共通部品を通しているか）。

---

## 11. 共通部品カタログ（このアプリの実装規約）

**大原則: 画面ごとに直さない。** 見た目・言い回し・折り返しの指定は下の部品と
`app/_lib/screens.ts` の1箇所だけが持つ。ページ側は「定義を1行足して、部品を呼ぶ」だけにする。
同じマークアップやクラス指定をページにコピペで並べた時点で、次の改善が画面数ぶんの手間になる。

### 11-1. 情報設計の唯一の定義: `app/_lib/screens.ts`

画面の **名前・所属グループ・並び順・リード文・工程順・「ここでは見ないこと」「次にどこへ」** を
1ファイルに集約している。ここから下記がすべて導出される。

| 導出先 | 実装 |
|---|---|
| サイドバーのグループと並び | `app/_lib/navigation.ts`（`SCREENS` を詰め替えるだけの薄い層） |
| ページ見出し・種別バッジ・役割ノート | `app/_components/ScreenHeader.tsx` |
| 毎月の締めの「n / 5」と前後リンク | `flowPositionOf()` |
| 権限によるメニューの出し分け | `visibleScreens(role)` |

- **使うとき**: 画面を追加した／名前を変えたい／並びを変えたい／説明文を直したいとき。
- **使ってはいけない場合**: 無い。画面の名前と説明をここ以外（ページのJSXやサイドバー）に書くのは禁止。
- 定義漏れは「文言が出ない」という無言の不具合になるため、`tests/lib/screens.test.ts` で
  全画面が `label / title / lead / does` を持つこと、リンク先が実在することを固定している。

### 11-2. `ScreenHeader`（全画面のページヘッダ）

```tsx
<ScreenHeader screen="/cleansing" action={<MonthPicker />} help={<SourceDataNote />} />
```

見出し・リード文・種別バッジ・「この画面ですること / ここでは見ないこと / 終わったら次に」の3行・
工程上の位置と前後リンクを、`screens.ts` の定義から描く。

- **使うとき**: すべての画面。ページの先頭に必ず1つ。
- **`title` / `lead` を上書きしてよい場合**: 対象月・車番・件数など**実データを含む見出し**のときだけ
  （例: `title={\`車番 ${no}\`}`）。言い回しを変えたいだけなら `screens.ts` を直す。
- **使ってはいけない場合**: ページから `PageHead` を直接呼ぶこと。`PageHead` は `ScreenHeader` 専用の下地。

### 11-3. `Card` / `.card`（囲みの面）

```tsx
<Card title="利用者別内訳">…</Card>       // 見出し付き
<section className="card p-5">…</section>  // 見出し不要・レイアウトを自分で組むとき
```

- **使うとき**: 白い面で囲むものすべて。
- **使ってはいけない場合**: `rounded-xl border border-line bg-white` と直接書くこと。
  `.card` は角丸・罫線・背景に加えて **`min-width: 0`** を持つ。これが無いと、
  横に並べた要素の中で長い日本語が縮まず、枠からはみ出す。
- `padding="tight"` は表を端まで見せたいとき（内側で余白を持つ場合）だけ。

### 11-4. `Prose` / `.prose-note`（長い文章を入れる器）

```tsx
<Prose>ここに数行の日本語を書いても、カードの外へは出ない。</Prose>
```

折り返し規則（`overflow-wrap: anywhere` / `word-break: auto-phrase` / `line-break: strict`）を
持つのは `globals.css` の `.prose-note` **1箇所だけ**。

- **使うとき**: 説明文・注意書き・URLやファイル名を含む文など、1行に収まらない可能性のある文章。
- **使ってはいけない場合**: 数値・金額（`num` を使う。途中で折り返してはいけない）、
  表のセル（列幅で制御する）。

### 11-5. `Disclosure`（折りたたみ）/ `Drawer`（引き出し）

- **`Disclosure`**: その場で読みながら操作を続ける説明（「どのファイルを選べばよいですか?」など）。
  本文は自動で `prose-note` に入るので、長い説明を書いてよい。
- **`Drawer`**: 読み終わったら画面から消えてよい長い説明。
- **使ってはいけない場合**: どちらも「隠すと業務が止まる情報」には使わない（必須の入力条件・エラー理由）。

### 11-6. `StagePanel` / `AlertPanel` / `EmptyState` / `StepRail`

| 部品 | 使うとき | 使ってはいけない場合 |
|---|---|---|
| `StagePanel` | 作業を段階に区切って見せるとき（取込・整形） | 単なる見出し付きの囲み（→ `Card`） |
| `AlertPanel` | 手を止めて読む必要がある注意・警告 | 常設の補足説明（→ `Prose`）。多用すると誰も読まなくなる |
| `EmptyState` | 一覧が0件・表が空のとき。**理由と次の一手を必ず書く** | 読み込み中（→ スケルトン） |
| `StepRail` | 工程の現在地を画面内に出すとき | 工程外の画面（`ScreenHeader` が工程番号を出さないのと同じ理由） |

### 11-7. はみ出しの根治（`globals.css`）

flex / grid の子要素は既定が `min-width: auto` で、**中の一番長い塊より小さくならない**。
日本語の長い一文や英数字の羅列があると、そこで枠を押し広げてはみ出す。
そのため画面ごとにパッチを当てず、`globals.css` で以下をまとめて効かせている。

- `main` 配下の面（`section` / `div` / `dl` / `details` など）に `min-width: 0`
- 画像・埋め込み・`pre`・入力欄に `max-width: 100%`
- `.card` とその直下に `min-width: 0`、`.prose-note` に `min-width: 0` / `max-width: 100%`

**`table` に `max-width: 100%` を掛けてはいけない。** 収支表などの横長の表は、外側の枠
（`overflow-x-auto`）より広いままにして横スクロールさせる作りになっており（`min-w-full` /
`min-w-[36rem]` / セルごとの `min-w-*`）、上限を掛けると列が潰れて読めなくなる。
同じ理由で `.card > *` にも上限を掛けない（カードの直下には表の外枠が入るため）。

いずれも `:where()` で書いており詳細度は0。Tailwind の `min-w-full` などを個別に当てれば勝てるので、
表を横スクロールさせたい箇所は今まで通り書ける。

---

*本デザインシステムは実プロジェクトのレビュー知見（`jp-web-design` 規律）を土台に、どのアプリにも移植できる形で整理したもの。判断に迷ったら「色を足す」より「余白・罫線・階層で解く」を選ぶ。*
