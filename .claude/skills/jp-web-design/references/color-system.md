# カラー規律 — Mode Aのブランド上書き

Mode Aの既定は `mode-a-graphite-amber.md` のGraphite × Amber。企業カラー・既存プロダクトの正本・利用者の明示指定がある場合だけ、本書で上書きする。好みだけで既定を崩さない。

## 1. 変えてよいもの / 変えないもの

変えてよい:

- `primary / primary-hover / primary-text`
- primaryに連動するfocus ring
- 企業ブランドが必要な最小の識別要素

変えない:

- `accent` は実行中・処理中・ヒアリング中だけという役割
- success / warning / danger / neutral の意味
- bg → surface → surface-alt → border の面階層
- 状態を色 + 文言 + borderで表す規律
- AIへ専用色・紫・ネオン・グラデーションを与えない規律

ブランド色が暖色でaccentと見分けにくい場合は、accentをアンバーのまま無理に併用しない。処理中をテキスト・進捗・アニメーションで示し、色の依存度を下げる。

## 2. ブランド色の調整

- 原色・蛍光色をそのまま使わず、彩度を一段落とす。
- Light/Darkで同じHEXを流用しない。Darkは明度を上げ、文字とのコントラストを機械検査する。
- primary上の文字はWCAG AAを満たす。足りなければprimaryを調整し、文字へ影を足してごまかさない。
- hoverは色相を増やさず同色相の明度差にする。
- コンポーネントへ生HEXを書かず、semantic tokenだけを参照する。

## 3. 背景と面

業務一覧・帳票・管理画面では無彩の `page-bg / bg / surface / surface-alt` を使う。ブランド色をページ全面へ薄く敷かない。toCの感情的な画面でブランドティントを使う場合も、主役面1箇所に限定し、本文の可読性を落とさない。

Darkでは次を同時に確認する:

1. page-bgとbgが見分けられる。
2. bgとsurfaceが見分けられる。
3. surfaceとsurface-altが見分けられる。
4. borderが面の境界として見える。
5. muted文字・warning・focus ringがWCAG AAを満たす。

## 4. 記録と検証

T2へ `Mode / primary / accentの役割 / Light-Dark-auto / フォント / 例外理由` を記録する。Light/Dark両方で通常・hover・focus・disabled・loading・errorを確認し、axe等の機械検査を通す。
