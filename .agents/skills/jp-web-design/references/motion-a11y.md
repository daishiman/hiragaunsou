# モーション・操作感・アクセシビリティ

モーション・操作感・アクセシビリティの全ルール。

## 1. モーション(控えめ・因果の説明のみ)

すべて `prefers-reduced-motion: reduce` で無効化。装飾のための動きは足さない。

| 用途 | 実装 | 時間 |
|---|---|---|
| 画面/質問の遷移 | 方向つきスライド(`--dir: 1/-1` で進む/戻る) | 出150ms / 入260ms |
| カード・選択肢の入場 | `rise-in`(fade + translateY(10px))+ `--stagger` 40〜70ms刻み | 260ms |
| 選択フィードバック | チェックの `pop-in`(scale 0.4→1) | 180ms |
| 押下 | `.pressable`(`active:scale(0.98)`) | 100ms |
| 進捗・数値 | バーの width transition / カウントアップ(rAF + ease-out) | 300〜900ms |

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

選択→自動送りは「ハイライトを一拍(約160ms)見せてから」遷移する。

## 2. 操作感の基準(参照実装: catnoseのプロダクト群 — Zenn/しずかなインターネット/Nani翻訳)

装飾ではなく「手に馴染む」ための規律。どのアプリでも同じ基準を適用する。

- **触った要素だけが動く**。画面全体を揺らす・スクロールを奪う・関係ない要素を動かすアニメーションは禁止。
- 反応の速度感: hover変化は即時(100ms以内)・押下は `.pressable`・遷移や入場は150〜260msのease-out短距離。バウンス・オーバーシュートは使わない。
- **説明文よりUIが先に語る**: placeholderで挙動を予告(「好きな言語で入力…」=自動判定を一言も説明せず伝える)。機能紹介は「アイコン+体言止め短文」のカードで、段落文を書かない。
- 主要CTAの状態が文脈を語る: 入力が揃うまでの見た目・実行中の「送信中…」・完了後の結果まで、ボタン1つの状態変化で進行が分かる。
- **キーボードショートカットはキーキャップUIで見せる**:

```css
.kbd {
  display: inline-block;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: #fff;
  padding: 0 5px;
  font-size: 11px;
  font-family: var(--font-num);
  color: var(--ink-muted);
  line-height: 1.6;
}
```

ショートカット(⌘+Enter等)はボタンの近くに `<span class="kbd">⌘</span><span class="kbd">Enter</span>` で常時またはhover時に表示し、「知っている人だけの隠し機能」にしない(Nani翻訳が送信ボタン近傍に「⌘ Shift Enter」をキーキャップ表示する方式)。挙動の規律は Skill `ux-design` §4-2「送信トリガ」。

## 3. アクセシビリティ

- **キーボードフォーカスを必ず可視化**:

```css
:where(a, button, input, select, textarea, summary):focus-visible {
  outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 4px;
}
```

- コントラスト: 本文は `--ink`、補足は `--ink-muted` まで。それより薄いグレーを本文に使わない。
- タップ領域は最低44px相当。装飾要素(スケルトン等)は `aria-hidden`。
- 状態を色だけで伝えない(バッジは文字ラベルも持つ)。モーダルはフォーカストラップ、トーストは `aria-live`。
