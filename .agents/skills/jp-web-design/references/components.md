# コンポーネントカタログ・アイコン・データ表現

コンポーネント・アイコン・データ表現の全ルール。ボタン / フォーム / バッジ / テーブル / 選択バー / モーダル / 空状態 / アイコン方針 / スライダー座標系 / バーチャートの使用条件。

実装時は必ず `assets/reference/styles.css`・`catalog.html` の動く実装を開いて流用する(記憶で似せて書かない)。

## 1. ボタン(3階層 + 破壊的)

```html
<!-- 主要CTA(画面に基本1つ。accentはこことキー数字だけ) -->
<button class="pressable rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50">送信する</button>
<!-- セカンダリ(操作=brandの罫線ボタン) -->
<button class="pressable rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand-deep hover:bg-brand-soft disabled:opacity-50">編集する</button>
<!-- 三次(静かな操作) -->
<button class="pressable rounded-md border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-subtle">キャンセル</button>
<!-- 破壊的(通常は罫線。塗りのdangerは最終確認モーダル内だけ) -->
<button class="pressable rounded-md border border-danger px-4 py-2 text-sm font-semibold text-danger hover:bg-red-50">削除する</button>
```

- ラベルは**動詞で終える**(「送信する」「保存する」)。「〜させていただく」禁止。
- 実行中はボタン内で「送信中…」+スピナーに置き換え、**幅を変えずに**二度押しを防ぐ。

## 2. フォーム

```html
<div class="space-y-1.5">
  <label for="email" class="flex items-baseline gap-2 text-xs font-medium text-ink">
    メールアドレス <span class="rounded bg-subtle px-1.5 py-0.5 text-[10px] text-ink-muted">必須</span>
  </label>
  <input id="email" type="email" inputmode="email"
         class="w-full rounded-md border border-line bg-white px-3 py-2 text-sm placeholder:text-ink-muted/60" />
  <p class="text-xs text-ink-muted">提案メールの送信先になります。</p>
  <!-- エラー時: input に border-danger、直下に -->
  <p class="text-xs text-danger">メールアドレスの形式が正しくありません。</p>
</div>
```

- ラベルは**上置き**。placeholder をラベル代わりにしない(例示のみ)。
- エラーは**その項目の直下**に、現象+直し方で表示。送信時は先頭エラーへスクロール。
- 数値は全角→半角を自動正規化・カンマ許容・`inputMode="numeric"`。ユーザーの入力癖に合わせる(直させない)。
- チェックボックス/ラジオはラベル全体をクリック可能に、タップ領域44px。
- disabled で黙らせるより、押させて理由を言う。disabled にするなら理由を近くに表示する。

## 3. ステータスバッジ(色相を増やさず塗り/罫線/打消しで区別)

```html
<span class="inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium bg-brand-soft text-brand-deep border-transparent">進行中</span>
<span class="... bg-subtle text-ink border-line">成約</span>
<span class="... bg-subtle text-ink-muted border-line line-through decoration-1">売却済</span>
<span class="... bg-white text-ink-muted border-line border-dashed">取下げ</span>
```

## 4. テーブル

- ヘッダー `text-xs text-ink-muted font-medium border-b border-line`、本文 `text-sm`。**単位は列ヘッダーに**(`typography-numerals.md`)。
- **数値列は右揃え + `.num`(生数値+カンマ)**。行は `border-b border-line hover:bg-subtle`、行アクションは右端。
- SPではカード型に組み替える(`layout-responsive.md` のモバイル情報削減)。横スクロール表のままにするなら `overflow-x-auto` のコンテナに入れる(**ページ全体を横スクロールさせない**)。
- 空のときは EmptyState(下記)を表に見せず単体で。

## 5. 選択バー(一括選択の相棒・ux-design `references/bulk-operations.md` §5-1とセット)

リストで1件でも選択されたら、リスト上部(または画面下部固定)に現れるバー:

```html
<div class="flex items-center gap-3 rounded-lg bg-brand-soft px-4 py-2 text-sm" role="status">
  <span class="font-bold text-brand-deep tnum">3件を選択中</span>
  <button class="text-brand-deep underline-offset-2 hover:underline">すべて解除</button>
  <div class="ml-auto"><!-- 主要アクション(選択件数入りラベル: 「3件に送信する」) --></div>
</div>
```

- ヘッダーの全選択チェックボックスと対で使う。絞り込み中は「表示中の◯件を選択」と対象を明示。
- 主要アクションのラベルに**選択件数を含める**(「送信する」ではなく「3件に送信する」)。

## 6. モーダル / トースト

- モーダルは「文脈を離れられない確認」だけに使う。`max-w-md`・白・`rounded-xl`・影あり。ESCで閉じる・フォーカストラップ・開いたら最初のコントロールへ。**破壊的確認は外側クリックで閉じない**。
- トーストは結果通知用。成功は静かに数秒で消える。**エラーは手で消すまで残し、次のアクションを添える**。`aria-live="polite"`。

## 7. 空状態 / スケルトン / 注意の面

```html
<div class="rounded-lg border border-dashed border-line px-6 py-12 text-center">
  <p class="text-sm font-semibold text-ink">まだ登録がありません</p>
  <p class="mt-1 text-sm text-ink-muted">最初の1件を追加すると、ここに一覧が表示されます。</p>
  <div class="mt-4"><!-- 主要アクション --></div>
</div>

<div class="skeleton h-10 w-full"></div>

<div class="rounded-md border border-caution-border bg-caution-soft px-4 py-3 text-xs leading-relaxed">
  この操作は取り消せません。内容をご確認ください。
</div>
```

空状態は「状態の説明 + 次の1歩」を必ずセットで。読み込みはスピナーよりスケルトン(レイアウトが跳ねない)。

## 8. アイコン方針

- 実績あるストロークアイコンセット(Lucide等)を**単色・同一線幅・16/20px**で。多色アイコン・素人っぽい自作SVG・絵文字は禁止。
- **頭文字アイコンの絶対禁止**: 四角や丸に漢字・頭文字1字を入れた「イニシャルアイコン」(「登」「報」等)は、どのモードでも絶対に作らない。
- **ありがちなメタファーアイコンも禁止**: 書類(ファイル)・棒グラフ・歯車のような「それっぽいだけ」の汎用アイコンを機能カードに置かない。アイコンは対象が一意に想起できるものだけ。**迷ったらアイコンなし**(太字タイトル+1行の説明のほうがましである)。
- 番号とタイポグラフィで構成できるなら、アイコン自体を省く。
- アイコン単独ボタンは原則作らない。作る場合は必ず `aria-label`。

## 9. カスタムコントロールの座標系(スライダー等)

**ネイティブ描画に自前の目盛りを「合わせにいく」のは必ずズレる。逆にする:**

- ネイティブ `<input type="range">` は透明化(ghost)して**入力だけ**を担当(ドラッグ・キーボード・タップ・当たり判定)。
- 可視要素(つまみ・塗り・目盛り・ラベル)は**すべて同一の式**から自前描画: `centerX(t) = calc(14px + t × (100% − 28px))`(28px=つまみ径、`box-sizing: border-box` 必須)。
- 検証は自分の式ではなく **DOM実測**(つまみとティックの `getBoundingClientRect` 中心比較)。
- 磁気スナップは目盛り近傍(t差<0.02)で吸着+対応チップ点灯。ただし**既に吸着中の値へは再吸着しない**(キーボード微調整が抜けられなくなる)。
- 離散量子化(例: 200段階)で「カリカリ」した手応えに。対数/平方根スケールで大きな値域をカバー。

## 10. データ表現 — バーチャートは「100%が定義できるとき」だけ

**「何に対する長さなのか」が言えないバーを描かない。**

バーを使ってよい3条件(いずれかを満たすこと):
1. **進捗**: 分母が明示できる(「目標120通に対して86通(72%)」— 100% = 目標)。
2. **構成比**: 合計が100%になる内訳。
3. **同一単位の実数比較**: 0起点で、最大値をデータ中の最大に固定し、軸(またはラベル)で基準を明示。

禁止・注意:
- **比率(%)同士を恣意的な幅で描かない**(反響率11.2%を45%幅のバーで表すのは嘘のスケール)。
- **2〜3値の比較はバーより「数字+差分」が速い**(「先月 11.2% → 今月 18.6%(+7.4pt)」)。バーチャートを使いすぎない。
- 裸の棒禁止: バーには必ずラベルと数値を添える(図形だけで意味を伝えない)。
- 色は現状=グレー、対象=brand。accentをグラフに使わない。
- 円グラフは2分割(残量表現)まで。3分割以上は表にする。
