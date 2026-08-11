---
title: "feat-ui-ux-consistency 仕様反映受領書"
layer: "feature-evidence"
feature: "feat-ui-ux-consistency"
graph_node_id: "feat-ui-ux-consistency"
dev_graph_node_id: "feat-ui-ux-consistency"
beads_ids:
  - "hiragaunsou-vrl"
  - "hiragaunsou-vrl.1"
  - "hiragaunsou-vrl.2"
  - "hiragaunsou-vrl.3"
  - "hiragaunsou-vrl.4"
recorded_at: "2026-08-11"
status: "accepted_with_pr_pending"
spec_impact: reflected
---

# feat-ui-ux-consistency 仕様反映受領書

## 結論

今回の変更は**見た目と言葉・画面骨格の一貫性**が本体であり、収支計算・DB schema・認可の業務契約は変えていない。  
ただし体験仕様（T2）、情報設計（T6）、画面作法（T7）、部品カタログ、検証契約へ影響するため、`spec-impact: reflected` と判定し正規フローで反映した。

## 中学生向けの説明

トラック1台ごとの「いくら儲かったか」を見る社内ツールの画面を、全部そろえた。  
言葉が画面ごとにバラバラだったのを同じ言い方にし、スクロールしても大事な見出しが消えにくくし、見るための表と直すための入力を使い分けた。計算そのものは変えていない。

## 専門的な説明

- Presentation 契約を T2 アーキタイプ継承 + T7 作法で固定
- sticky は CSS top 宣言だけでなく、工程帯と filter 帯の実矩形非重複を E2E 不変条件化
- ラベルは型付き SSOT + 未知値 fail-closed
- `/usage` は JST 暦月境界 (`getJstCalendarMonth`) で集計し業務対象年月と分離
- route inventory を `SCREENS` から導出し手書き一覧を廃止

## 正規フローでの反映判定

| 層 | 判定 | 記録または反映内容 |
| --- | --- | --- |
| `system-spec/` | 更新 | requirements / ui-ux / frontend / testing-qa / index |
| `specs/` | 更新 | `ui-ux-consistency-addendum.md` |
| `architecture/` | 更新 | `frontend-ui.md` |
| `features/` | 更新 | `feat-ui-ux-consistency.md` |
| `tasks/` | 更新 | final-review タスク仕様 |
| アプリ `docs/product/` | 更新 | T2 / T6 / T7 / backlog 分割 / design-system 分割 |
| `docs/features/` | 更新 | 本受領書 |

## 品質ゲート受領

| ゲート | 結果 |
| --- | --- |
| typecheck | PASS |
| lint | PASS（error 0 / 既存 warning 2） |
| focused vitest | PASS（関連ファイル） |
| 500行分割 | PASS（design-system / backlog / screens） |

## 500行制約

| ファイル | 対応 |
|---|---|
| `docs/design-system.md` (710→402) | §11以降を `design-system-components.md` へ分離 |
| `docs/product/backlog.md` (574→465) | 完了班を `backlog-completed-waves.md` へ分離 |
| `app/_lib/screens.ts` (638→175) | 定義配列を `screens.catalog.ts` へ分離 |

## 残課題

- 表の先頭列（車番）固定は未実装
- 使われていない `ResetPasswordForm.tsx` の削除は別整理
- 赤字分析の `extraColumnLabel` 旧語は計算側ファイルのため別作業
- E2E 全件は preview 環境での実行が前提（本レビューでは focused を正）
- beads: epic `hiragaunsou-vrl` と子 `.1`〜`.4`（`.4` は残課題として open 維持）

## ブランチ / PR

- graph node: `feat-ui-ux-consistency`
- 作業 branch: `devgraph/feat-ui-ux-consistency`（既存 `feat/ui-ux-consistency` から継続）
- base: `main`
