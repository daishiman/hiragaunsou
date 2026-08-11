---
status: confirmed
layer: architecture
related_feature: feat-ui-ux-consistency
---

# フロントエンド UI アーキテクチャ判断

## 決定

1. **表示契約は上流から1方向**: T2（体験）→ T6（IA）→ T7（作法）→ design-system / components → screens → tests
2. **sticky は top 値の宣言だけでは足りない**: 工程帯と絞り込み帯の実矩形が重ならないことを E2E の不変条件にする
3. **語彙は fail-closed 表示**: 未知 enum を raw 露出させず「未対応の〜」へ倒す。調査用 raw はログのみ
4. **単一レコード編集は縦**: 比較が主目的でない横表を廃止し、DefinitionList + 入力へ寄せる
5. **画面 inventory は手書きしない**: `SCREENS` から E2E 対象を導出し、route 追加漏れを機械検出する

## 採らなかった案

| 案 | 却下理由 |
|---|---|
| 全画面をカード化 | 106台比較が破綻する |
| sticky を単一合成帯にする | 画面ごとの「固定すべき情報」が異なり、情報が増える |
| 画面ごとに説明カード3行を常設 | lead / does の重複で認知負荷が増える |

## 影響範囲

- 計算 usecase / DB / API 認可: 表示ラベルと期間境界の整合のみ。業務ロジックは不変
- 認証シェル: `AuthShell` でログイン/404のフッターを共有
