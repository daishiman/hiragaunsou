# Mode A — Graphite × Amber

業務システム・管理画面・開発者ツールの既定テーマ。無彩色を骨格にし、アンバーを「処理が動いている状態」だけへ限定する。共有された Harness Studio は色と設計原則の基準であり、画面構造をそのまま複製しない。構造は `information-design.md` の業務分析から導く。

## 1. 役割契約

- **primary（グラファイト）**: 主要CTA、選択、リンク、現在地。主要CTAにアンバーを使わない。
- **accent（アンバー）**: 実行中、処理中、ヒアリング中など、いま動いている状態だけ。AI機能の装飾色にはしない。
- **semantic status**: success / warning / danger / neutral。色と同時に文言・形・位置を使い、色だけで区別しない。
- **surface hierarchy**: page-bg → bg → surface / surface-alt → border の順で明度差を保つ。Darkでも面を黒一色へ潰さない。
- **AIを特別扱いしない**: AIヒアリング、生成、提案も通常機能と同じコンポーネントを使う。AI専用の紫・ネオン・グラデーションを作らない。

## 2. 正本トークン

```css
:root,
html[data-theme="light"] {
  color-scheme: light;
  --primary: #232326;
  --primary-hover: #3a3a3f;
  --primary-text: #ffffff;
  --bg: #f1f1ef;
  --surface: #ffffff;
  --surface-alt: #e9e9e6;
  --text: #141417;
  --text-muted: #5c5c62;
  --border: #d9d9d5;
  --border-strong: #c4c4bf;
  --accent: #b45309;
  --accent-text: #ffffff;
  --success: #166534;
  --success-bg: #ddefe3;
  --warning: #92580a;
  --warning-bg: #f3e8d3;
  --danger: #b91c1c;
  --danger-bg: #f6e2e0;
  --neutral: #52525b;
  --neutral-bg: #e6e6e3;
  --page-bg: #e2e2df;
  --focus-ring: #232326;
}

html[data-theme="dark"] {
  color-scheme: dark;
  --primary: #fafafa;
  --primary-hover: #d4d4d8;
  --primary-text: #141417;
  --bg: #1a1a1e;
  --surface: #242429;
  --surface-alt: #2e2e34;
  --text: #fafafa;
  --text-muted: #b0b0b8;
  --border: #3f3f46;
  --border-strong: #52525b;
  --accent: #fbbf6d;
  --accent-text: #1c1305;
  --success: #6ee7a0;
  --success-bg: #1a3323;
  --warning: #f2c464;
  --warning-bg: #362a15;
  --danger: #fca5a0;
  --danger-bg: #3b201f;
  --neutral: #c0c0c8;
  --neutral-bg: #33333a;
  --page-bg: #121215;
  --focus-ring: #fafafa;
}
```

自動テーマは `html:not([data-theme])` と `prefers-color-scheme: dark` の組み合わせでDark値を再定義する。`data-theme="light|dark"` があるときはOS設定より手動指定を優先する。

## 3. タイポグラフィ

```css
:root {
  --font-ui: "IBM Plex Sans", "Hiragino Sans", "Yu Gothic", sans-serif;
  --font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
  --font-num: "IBM Plex Sans", "SF Pro Text", "Segoe UI", sans-serif;
  --tap: 44px;
}
```

- 日本語本文・見出しはシステム日本語フォントへ自然にフォールバックさせる。
- UI英数字は IBM Plex Sans、ID・タグ・ログ・ステータスは JetBrains Mono。
- 本文13〜14px、ページタイトル19px（SPは17px）、ボタン13〜14px/700。
- 外部フォントが使えない環境でもフォールバックでレイアウトが崩れないようにする。Google Fontsは性能・プライバシー要件を確認してから採用する。

## 4. テーマ実装

1. `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` と `<meta name="color-scheme" content="light dark">` を入れる。
2. 初期値は `auto`。属性を付けずOSへ追従させる。
3. `light` / `dark` を選んだときだけ `html[data-theme]` を設定する。
4. 選択をlocalStorageまたはアカウント設定へ保存し、初回描画前に復元してテーマの点滅を防ぐ。
5. auto時だけ `matchMedia('(prefers-color-scheme: dark)')` の変更へ追従する。
6. `color-scheme` をCSSにも宣言し、フォーム・スクロールバーなどのネイティブUIも合わせる。

## 5. レスポンシブ骨格の選び方

ナビゲーションは項目数と最頻作業から選ぶ。Harness Studioの骨格を無条件にコピーしない。

| 条件 | PC | Tablet | SP |
|---|---|---|---|
| 主要ナビ1〜3個 | 上部ナビ | 上部ナビ | 上部ナビまたは下部タブ |
| 主要ナビ4〜5個・反復業務 | 212pxサイドバー | 68pxアイコンレール | 下部固定タブバー |
| 6個以上 | 業務場面で再編し5個以下へ | 同左 | 「その他」へ第2階層化 |

- 640px以下はSP、641〜1024pxはTablet、1025px以上はPC骨格の初期値。Tailwindを使う場合は既定ブレークポイントへ近似し、独自値の乱立を避ける。
- 下部タブバーは `position: fixed`、上罫線、`z-index: 10`、safe-areaを加算する。本文下部へ `calc(76px + env(safe-area-inset-bottom))` 以上を確保する。
- SPのカードは縦積みへ切り替え、第一階層を名前・キー値・状態の3項目へ減らす。長い名称は省略表示から詳細へ到達できるようにする。
- 再利用部品の切替はコンテナクエリ、アプリ骨格の切替だけメディアクエリを使う。

## 6. コンポーネント契約

- 主要CTA: `primary`、44px以上、8px radius、700。hoverは `primary-hover`。
- 状態バッジ: 背景 + 30%相当の色付きborder + 文言。色だけで示さない。
- 実行中タグ: `accent`文字 + accent 35% border。アンバー塗りのCTAを作らない。
- 入力: `surface`背景、`border-strong`、44px以上。ラベルをplaceholderで代替しない。
- カード: `surface`、10px前後のradius、通常border、操作可能な場合だけhoverで`border-strong`。
- アクティブナビ: `surface` + border +太字を基本にする。SP下部タブだけ、補助符号としてアイコンへaccentを使ってよい。
- 状態は `idle / hover / focus / disabled / loading / success / warning / error / empty` を同じ精度で設計する。

## 7. アクセシビリティ契約

- タップ領域を44×44px以上にする。
- `:focus-visible` に2px outline + 2px offsetを出す。
- `prefers-reduced-motion: reduce` ですべての装飾transition/animationを止める。
- `prefers-contrast: more` でborderを強め、muted文字を本文色へ上げる。
- `nav` / `main` / `section`、`aria-label`、`aria-current="page"` を使う。
- Light/Darkの本文・操作・状態色を機械検査し、WCAG AAを満たす。特にDarkのwarningを必ず確認する。
- 375 / 768 / 1280 / 1600pxに加え、iPhone safe-area、キーボード操作、スクリーンリーダーで実測する。

## 8. 禁止事項

- 紫・ネオン・不要なグラデーションでAIらしさを演出しない。
- accentを主要CTA・リンク・単なる強調・AI専用色に使わない。
- DarkをLightの機械的反転で作らない。両テーマのsurface階層と状態色を個別に定義する。
- 色だけで状態や現在地を示さない。
- 参考画面のサイドバー・カード・文言を、業務構造を調べずに流用しない。
