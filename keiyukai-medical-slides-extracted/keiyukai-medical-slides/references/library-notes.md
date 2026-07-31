# html-to-pptx の挙動とコツ（最重要・必読）

このスキルは npm の **html-to-pptx**（pptxgenjs を内部利用）を Playwright(Chromium) の
中で実行し、`getBoundingClientRect()` で読み取った描画結果を **ネイティブな PowerPoint
の図形・テキストボックス・表・グラフ** に変換する。Markdown→画像ではなく「編集可能な
ネイティブ要素」が出力されるのが要点。挙動には強いクセがあり、デザインの作り方はすべて
このクセに最適化してある。

`framework/html-to-pptx.browser.js` は、文字幅バッファを調整するパッチ（後述§7）を
適用済みの専用ビルド。**差し替えないこと。**

---

## 1. 太字は font-weight ≥ 600 で決まる【太字で階層を作るための要】

ライブラリは `font-weight` が **600 以上のとき PPT 側を bold**、**500 以下なら regular（非太字）**
で出力する。この閾値を使って**太字で階層を作る**。

- → **タイトル・見出し・KPI・キーワード＝700（太字）**、**本文＝500（regular）**。
  どこが要点かが PPT 上でも一目で立つ。
- 行内の強調は `.strong`（700・濃インク）、最重要の1語だけ `.strong-accent`（700・朱の差し色）。
- ただし **“全部太字”にしない**。本文まで 600+ にすると強弱が消えるので、本文は 500 を保つ。
- `.t-hero` / `.t-title` / `.t-section` / `.t-card` / `.kpi*` は **700 で定義済み**。
  本文系（`.body` / `.body-sm` / `.lead` / `.meta`）は **500 のまま**にする。
- 太字ランは埋め込みの Bold ウェイトで描かれる（§12）。**Windows / Mac とも同じ太さ**で出る。

## 2. 背景はソリッド色のみ取得される

`background-color` の単色だけが図形の塗りとして拾われる。**グラデーション・画像背景は
無視される**。これはフラットなデザインと完全に一致するので問題にならない。むしろ
グラデを使わない設計を徹底する。

## 3. 座標換算（px → pt）

キャンバスは **1280×720px = 10in×5.625in（16:9）**。換算係数は **px × 0.5625 = pt**。
（例：64px ≈ 36pt、42px ≈ 23.6pt、18px ≈ 10pt）

- Web の見た目より **大きめの px** を使う（タイトル 42〜62px、本文 17〜22px）。
- セーフマージンは `.pad{padding:72px 90px}`。要素は左右 90px・上下 72px の内側に置く。

## 4. テキストは左寄せが基本。中央寄せは「1行」だけ

ライブラリはテキストノードごとに、描画位置にぴったりのタイトなボックスを作る。その結果：

- **複数行の中央寄せは保持されない**（各行が別ボックスとして左基準に並ぶ）。
- 中央寄せして良いのは **1行に収まるテキストだけ**（表紙の1行見出し等）。
- **本文・箇条書きは必ず左寄せ**。改行は `<br>` で意図的に入れる。

## 5. 図形の作り分け（角丸・線・ドット）

- `border` + `border-radius` のある div → 角丸四角（roundRect）。カードに使う。
- 正方形 + `border-radius:9999px` → 真円（ellipse）。**塗りドット**や番号の丸に使う。
- 細い div に背景色（例 `height:2px;background:...`）→ 線/バー。区切り線・カラーバーに使う。
- 背景も枠線もない div は「塗りなし・線なしの透明図形」になる（無害。レイアウト用ラッパに使える）。

## 6. flexbox / grid はそのまま使える

ライブラリは描画後のジオメトリを読むため、**flex/grid の通常フローが正しく反映される**。
セマンティックで素直な HTML を書けばよい。

- 通常の段組み・カード並べは flex/grid で書く。
- **`position:absolute` も最終座標が読まれるので使える**（`transform: translate(...)` も最終位置に
  反映される）。表紙の主役組み・中扉の配置や、**図解（後述§11）**で活用する。

## 7. 1文字だけ折り返す不具合と、そのパッチ

Chromium と LibreOffice/PowerPoint で日本語フォントのメトリクスが微妙に違うため、タイトの
テキストボックスだと末尾の1文字だけが2行目に落ちることがある（例：「…3つの課」「題」）。
さらに後続要素の Y 座標がズレて重なる二次被害も出る。

- 対策として同梱ビルドは、テキストボックス幅に **約6%＋0.10inch のバッファ** を加えてある
  （`analyze.ts` の `const w = ... * 1.06 + 0.10`）。左寄せなので右側の余白増加は無害。
- それでも長いタイトルが折り返す場合は、**文言を短くする**か **`<br>` で明示改行** する。
- フォントが未インストールだと計測がずれて折り返しやすい。`build_pptx.py` が同梱フォントを
  自動導入するので、**必ずこのランナー経由でビルドする**。

## 8. 画像は HTTP 経由でしか埋め込めない

pptxgenjs は `file://` から画像を埋め込めない。`build_pptx.py` は HTML のあるディレクトリを
ローカル HTTP サーバで配信して解決している。**ロゴ等は deck.html から相対パス
（例 `assets/logo-green.png`）で参照** し、その画像を同じ作業ディレクトリに置く。

## 9. ネイティブグラフ（data-pptx-chart-config）

div に `data-pptx-chart-config='{...}'`（JSON）属性を付けると、その div の矩形位置に
pptxgenjs の `addChart(type, data, options)` でネイティブグラフを描画する（編集可能）。

```html
<div style="position:relative;width:540px;height:300px;"
  data-pptx-chart-config='{
    "type":"bar",
    "data":[{"name":"在宅患者数","labels":["2021","2022","2023"],"values":[120,205,318]}],
    "options":{"barDir":"col","chartColors":["7DBE2A"],"showValue":true,
      "showLegend":false,"showTitle":false,
      "valGridLine":{"color":"E8ECE3","size":1},"catGridLine":{"style":"none"}}
  }'></div>
```

- `type`: "bar"（縦は `barDir:"col"`）, "line", "pie", "doughnut", "area" など pptxgenjs 準拠。
- `data`: `[{name, labels[], values[]}]`。系列を増やせば複数系列。
- 色は **必ずブランド緑系**：単系列は `["7DBE2A"]`、複数なら `["7DBE2A","65A018","BFDF8A","3F6510"]`。
- JSON は **シングルクォート属性の中にダブルクォート** で書く（HTML 属性の都合）。
- 軸ラベル色は `5F6A5C`/`8A9485`、グリッドは `E8ECE3`、データラベルは `3A4438`。
  数値フォントは `Inter`、日本語ラベルは `Noto Sans JP` を指定すると整う。

## 10. ネイティブ表（<table>）

通常の `<table>` を書くと、セルごとの計算済みスタイル（塗り・文字色・太字・寄せ・罫線・
フォント・パディング）を読み取って **ネイティブな編集可能テーブル** に変換する。

- セルの太字も §1 と同じく font-weight ≥600 で決まる。ヘッダ行だけ 700 にする。
- 数値セルは `font-family:Inter;text-align:center`、見出し列は `text-align:left`。
- `border-collapse:collapse; table-layout:fixed; width:1100px;` を基本にする。
- 行の塗りを白／`--surface-soft` で交互にするとゼブラになり可読性が上がる。
- ヘッダ帯は `--primary-deep` 地に白文字。

## 11. 図解（連携図・概念図）

`position:absolute` の最終座標が読まれることを利用して、箱と直線で図解を作れる。

- **箱**：`.dgm-box`（白・角丸・1px 罫線）/ 中心 `.dgm-hub`（ロゴ緑）。中に `.t`（見出し）＋`.s`（補足）。
- **コネクタ**：`.dgm-line-v`（縦）/ `.dgm-line-h`（横）の細い div。**縦横の直線のみ。斜め線は作れない**。
  箱をハブの上下左右に揃えて直線で結ぶ（ハブ＆スポーク）。座標は実測で合わせる。
- **矢印**：方向を示すときは図形矢印ではなく**「→」グリフ**を text で置く（`.arrow`、Inter）。確実に出る。
- **重なり順**：コネクタを先（DOM 前方）に、箱を後（前面）に置く。線端が箱の下に隠れて綺麗になる。
- 箱のラベルは1行に収まる長さにする（§4：複数行だと中央寄せが崩れて左寄せになる）。長い語は
  `.s`（補足）に逃がすか箱幅を広げる。
- 実例：`slide-patterns.md` P12（地域連携図）、`examples/model-deck.html` 12枚目。

## 12. フォント埋め込み（Windows / Mac 共通表示）

ビルダーは出力 pptx に**フォントを埋め込む**（既定で有効）。これにより、閲覧 PC に Noto Sans JP /
Inter が無くても**同じ表示**になる（Mac/Windows を問わない）。

- 仕組み：`framework/embed_fonts.py` が `framework/embed-fonts/` の静的 TTF（Noto Sans JP の
  Medium=regular 枠・Bold=bold 枠、Inter の Medium=regular 枠・SemiBold=bold 枠）を
  `ppt/fonts/*.fntdata` として埋め込み、`embeddedFontLst` と全文字埋め込みフラグを書く。
- html-to-pptx は各ランに `<a:latin>` だけでなく **`<a:ea>`（東アジア）/`<a:cs>` にも同じフォント名**を
  設定するため、**日本語も埋め込みフォントで表示**される（ここが崩れないための要）。
- weight 500 のラン → regular 枠（＝埋め込み Medium）、weight ≥600 のラン → bold 枠で表示される。
  デザインの weight 設計と一致しているため、見た目が変わらない。
- 埋め込みでファイルは ~8MB 程度になる（配布・編集前提なら許容）。サイズを避けたい一時確認では
  `build_pptx.py ... --no-embed` で無効化できる。
- フォントを増やす/差し替える場合は `embed-fonts/` に静的 TTF を置き、`embed_fonts.py` の
  `default_map()`（typeface 名と regular/bold の対応）を更新する。

---

## ビルド手順（要約）

```bash
# 作業ディレクトリに deck.css と assets/ を用意し、deck.html を書いたうえで:
python3 <skill>/framework/build_pptx.py deck.html deck.pptx
#   → ビルド後、フォントが自動で埋め込まれる（Windows/Mac 共通表示。無効化は --no-embed）

# QA（LibreOffice で PDF 化 → 画像化して目視確認）:
python3 /mnt/skills/public/pptx/scripts/office/soffice.py --headless --convert-to pdf deck.pptx
pdftoppm -jpeg -r 120 deck.pdf slide   # slide-01.jpg ...
```

毎回ビルド後に**必ず画像で全スライドを目視**し、はみ出し・重なり・1文字折り返しを点検する。
