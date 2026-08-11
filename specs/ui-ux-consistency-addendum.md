---
title: "UI/UX一貫性 追補"
graph_node_id: "feat-ui-ux-consistency"
status: confirmed
related:
  - system-spec/ui-ux.md
  - architecture/frontend-ui.md
  - features/feat-ui-ux-consistency.md
---

# UI/UX一貫性 追補

## 背景

依頼者の5指摘を、画面単位の場当たり修正ではなく横断作法として固定する。

## 契約

1. **用語**: T7 統一表。未知キーは fail-closed 表示。
2. **骨格**: アプリヘッダー / 工程帯 / 絞り込み帯 / 本文 / 表見出し / 操作帯。
3. **器**: 比較は表、1件判定・1件編集はカード/定義リスト。
4. **検証**: inventory・語彙・sticky 実矩形・4幅を機械検査。
5. **期間**: 業務の対象年月と AI 利用の JST 暦月を混同しない。

## 非変更

- 収支計算式、DB schema、認可、取込パーサの業務規則

## 参照正本

アプリ内:

- `hiragaunsou-vehicle-pl-extracted/docs/product/T2-experience-spec.md`
- `hiragaunsou-vehicle-pl-extracted/docs/product/T6-information-architecture.md`
- `hiragaunsou-vehicle-pl-extracted/docs/product/T7-ui-conventions.md`
- `hiragaunsou-vehicle-pl-extracted/docs/design-system.md`
- `hiragaunsou-vehicle-pl-extracted/docs/design-system-components.md`
