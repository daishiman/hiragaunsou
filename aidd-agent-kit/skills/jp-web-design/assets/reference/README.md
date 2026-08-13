# リファレンス実装(発注者検収済み・2026-07)

このフォルダは jp-web-design / ux-design の全規律を実装した**動く正解**。新しいアプリを作るときは、該当ファイルを開いて構造とクラス設計をそのまま流用する(記憶で似せて書かない)。

## ファイルマップ

| ファイル | 何の見本か |
|---|---|
| `styles.css` | **Mode A Graphite × Amber**のLight/Dark/autoトークン・primary CTA・状態専用accent・semantic badge・IBM Plex/JetBrains Mono・hover/pressed/入場/modalモーション・reduced-motion/high-contrast・44px操作領域・safeなsurface階層・全コンポーネント |
| `theme.js` | auto/light/dark切替、localStorage永続化、初回描画前の復元。auto時はCSSのOS追従を維持 |
| `index.html` | **Mode A(Graphite × Amber / ミニマル・信頼)**。3項目なので上部ナビを採用。ホーム・一括選択・確認モーダル・下書き・レポートに加えテーマ切替を実装 |
| `app.js` | **UX規律のvanilla実装**。イミュータブルstate・Excel数値整形(Intl)・一括送信(進捗/部分成功/要確認キュー/再試行)・下書き自動保存(debounce/復元通知/破棄/送信時削除)・blur検証+入力中解除・IMEガード・Enter=次フィールド/⌘⌃Enter=送信・全角正規化・トースト(成功自動消滅/エラー残留+アクション) |
| `catalog.html` | 部品カタログ。カラースウォッチ(ブランド適用サンプル込み)・データ表現の正誤例(数字+差分/進捗バー)・タイポ見本(¥記号の単位扱い・カンマ縮小・和文/欧文数字比較) |
| `pop.html` | **モードB(Pop・親しみ)**。パステル変換トークン・マスコット2バージョンの配置・黒太字+傾きの見出し・波線下線・くるっと矢印(確定版)・CTA(ブライト+白字+リング)・白グリフのカスタムチェックボックス・調整ボタン+セグメント+トグル・破線機能カード・波フッター |
| `mascot-bordered.svg` / `mascot-borderless.svg` | マスコットの再着色済み2バージョン(原本は `../pop-mascot-editable.svg`) |

## React / TypeScript への移植ルール

構造・クラス名・数値をそのまま持ち込む。フレームワークが変わっても**見た目とふるまいの正解はこのフォルダ**。

1. **トークン**: `styles.css` のLight/Dark/autoブロックを `globals.css` にコピー。Tailwind v4なら `@theme inline` で橋渡し(SKILL.md §1)。値をJS定数に複製しない(CSSが単一の真実)。
2. **クラス→コンポーネント対応**(propsは最小限に):
   - `.btn.btn-primary/secondary/tertiary/danger-outline` → `<Button variant>`(primaryはGraphite。実行中は幅固定で「送信中…」+spinner)
   - `.badge.badge-*` → `<StatusBadge status>`(runningだけaccent、他はsemantic color。必ず文言+border)
   - `.field`(label上置き+hint+error-msg) → `<Field>`(エラーはblurで判定・入力中に解除)
   - `.num / .num-display / .num-sep / .currency / .unit` → `<Num value unit currency display?>`(整形は `Intl.NumberFormat('ja-JP')`+カンマを`<span class="num-sep">`置換)
   - 選択バー / `.deal-card` / `.empty-state` / `.skeleton` / `.kbd` → 同名コンポーネント
   - モーダル(フォーカストラップ・ESC・復帰) / トースト(aria-live) → `app.js` の挙動をそのまま移植
   - Pop: `.pop-cta` `.pop-chip` `.segmented` `.switch` `.tune-btn` `.mascot-img` `.hand-note`
3. **状態ロジック**: `app.js` の各関数が仕様。React版のhooks(useDraft / useBulkSelection / useSubmitKeys / runWithConcurrency 等)は **Skill ux-design の `assets/ux-patterns.tsx`** を使う。
4. **モーション**: `motion-a11y.md` の時間表を使い、hover/pressed/入場/overlay/loadingを意味のある対象だけへ実装する。再レンダーのたびに入場させない。
5. **検証**: 移植後も検収チェックリスト(Light/Dark/auto・4幅・hover/touch・reduced-motion・動的パス操作)を必ず通す。

## 使い方(新規アプリ)

1. 起動プロトコル(SKILL.md冒頭)でカラー契約・ロゴ・モード・テーマを確定(未指定はMode A Graphite × Amber)
2. `styles.css` と `theme.js` をコピー。企業カラーの明示要件がある場合だけsemantic tokenを差し替える(Popは`mode-b-pop.md`)
3. 該当モードのHTMLを開き、画面構造(ホームの順序・一括操作・モーダル)を流用
4. ロジックは `app.js`(vanilla)か `ux-patterns.tsx`(React/TS)から
