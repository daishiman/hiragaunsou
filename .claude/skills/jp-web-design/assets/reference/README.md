# リファレンス実装(発注者検収済み・2026-07)

このフォルダは jp-web-design / ux-design の全規律を実装した**動く正解**。新しいアプリを作るときは、該当ファイルを開いて構造とクラス設計をそのまま流用する(記憶で似せて書かない)。

## ファイルマップ

| ファイル | 何の見本か |
|---|---|
| `styles.css` | 全トークン(brand/accent/ink/mist/soft・--font-num)・ボタン3階層・バッジ・フォーム・テーブル・モーダル・トースト・空状態・スケルトン・kbd・num/num-sep/currency/unit・rise-in等モーション・reduced-motion・コンテナクエリ(.list-host)・カード化(.deal-card) |
| `index.html` | **モードA(ミニマル・信頼)**。ホーム(要対応→次のアクション→最近→KPI)・提案リスト(一括選択/自動除外)・送信前確認モーダル・登録モーダル(下書き復元バー・キーキャップ)・レポート(主数字/数字+差分/分母明示バー/根拠開示) |
| `app.js` | **UX規律のvanilla実装**。イミュータブルstate・Excel数値整形(Intl)・一括送信(進捗/部分成功/要確認キュー/再試行)・下書き自動保存(debounce/復元通知/破棄/送信時削除)・blur検証+入力中解除・IMEガード・Enter=次フィールド/⌘⌃Enter=送信・全角正規化・トースト(成功自動消滅/エラー残留+アクション) |
| `catalog.html` | 部品カタログ。カラースウォッチ(ブランド適用サンプル込み)・データ表現の正誤例(数字+差分/進捗バー)・タイポ見本(¥記号の単位扱い・カンマ縮小・和文/欧文数字比較) |
| `pop.html` | **モードB(Pop・親しみ)**。パステル変換トークン・マスコット2バージョンの配置・黒太字+傾きの見出し・波線下線・くるっと矢印(確定版)・CTA(ブライト+白字+リング)・白グリフのカスタムチェックボックス・調整ボタン+セグメント+トグル・破線機能カード・波フッター |
| `mascot-bordered.svg` / `mascot-borderless.svg` | マスコットの再着色済み2バージョン(原本は `../pop-mascot-editable.svg`) |

## React / TypeScript への移植ルール

構造・クラス名・数値をそのまま持ち込む。フレームワークが変わっても**見た目とふるまいの正解はこのフォルダ**。

1. **トークン**: `styles.css` の `:root` ブロックを `globals.css` にコピー。Tailwind v4なら `@theme inline` で橋渡し(SKILL.md §1)。値をJS定数に複製しない(CSSが単一の真実)。
2. **クラス→コンポーネント対応**(propsは最小限に):
   - `.btn.btn-primary/secondary/tertiary/danger-outline` → `<Button variant>`(実行中は幅固定で「送信中…」+spinner)
   - `.badge.badge-*` → `<StatusBadge status>`(塗り/罫線/打消し/破線の4形)
   - `.field`(label上置き+hint+error-msg) → `<Field>`(エラーはblurで判定・入力中に解除)
   - `.num / .num-display / .num-sep / .currency / .unit` → `<Num value unit currency display?>`(整形は `Intl.NumberFormat('ja-JP')`+カンマを`<span class="num-sep">`置換)
   - 選択バー / `.deal-card` / `.empty-state` / `.skeleton` / `.kbd` → 同名コンポーネント
   - モーダル(フォーカストラップ・ESC・復帰) / トースト(aria-live) → `app.js` の挙動をそのまま移植
   - Pop: `.pop-cta` `.pop-chip` `.segmented` `.switch` `.tune-btn` `.mascot-img` `.hand-note`
3. **状態ロジック**: `app.js` の各関数が仕様。React版のhooks(useDraft / useBulkSelection / useSubmitKeys / runWithConcurrency 等)は **Skill ux-design の `assets/ux-patterns.ts`** を使う。
4. **検証**: 移植後も SKILL.md §14 の検収チェックリスト(4幅実測+動的パス操作)を必ず通す。

## 使い方(新規アプリ)

1. 起動プロトコル(SKILL.md冒頭)の逆質問でプライマリ・ロゴ・モードを確定
2. `styles.css` をコピーしてトークンだけ差し替え(Popなら§15-1のパステル変換)
3. 該当モードのHTMLを開き、画面構造(ホームの順序・一括操作・モーダル)を流用
4. ロジックは `app.js`(vanilla)か `ux-patterns.ts`(React/TS)から
