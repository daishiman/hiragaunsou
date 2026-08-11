---
graph_node_id: "feat-ui-ux-consistency"
artifact_kind: "feature"
project_id: "hiragaunsou-vehicle-pl"
domain: "frontend-ui"
tags: ["ui", "ux", "mvp", "vocabulary", "sticky", "screen-inventory"]
priority: "high"
title: "全画面の言葉・上下の作り・貼り付き・表の使い分けを1つの作法にそろえる"
owners: ["daishiman"]
created_at: "2026-08-11T00:00:00Z"
updated_at: "2026-08-11T14:00:00Z"
status: "in_review"
tracker_binding: "beads"
---

# 全画面の言葉・上下の作り・貼り付き・表の使い分けを1つの作法にそろえる

## 0. なぜこの feature があるのか

依頼者から5つの指摘が出た。

1. ラベルが実態と合っていない
2. ヘッダー・フッターの構造が画面ごとに違う
3. 見えていてほしい情報がスクロールで消える
4. サイドバーが平坦
5. 何でも表になっている

画面ごとの場当たり修正では再発するため、**1つの作法 (T7)** を決めてから全画面へ当てる。

## 1. 目的

内部23画面 + 認証/404 の表示画面で、用語・骨格・固定帯・器（表/カード/定義リスト）を同じ契約で見せる。

## 2. ゴール

- 同じ概念は同じ日本語で出る
- 対象年月・件数・列見出し・主要操作が必要な場所で貼り付く
- 「見比べるなら表 / 1件を読むなら定義リスト」が画面ごとに一貫する
- route 追加や語彙回帰を自動検査で検出できる

## 3. 含むもの

- `docs/product/T7-ui-conventions.md` と T2/T6 の整合
- 共通部品: `DataTable` / `DefinitionList` / `StickyFilterBar` / `Badge` / `SectionHeading` / `AuthShell` / `formStyles`
- ラベル SSOT: `fieldLabels` / `factorLabels` / `kindLabels` / `severity`
- 車両1台明細の縦フォーム化
- 利用状況の JST 暦月集計と利用者別比較表
- 画面 inventory / 語彙 / sticky 矩形の unit・E2E

## 4. 含まないもの

- 収支計算ロジック・DB schema・認可判定の変更
- 本番 Google ログイン設定
- パスワード再設定機能の復活

## 5. 受入

- typecheck / lint (error 0) / 関連 unit・component テストが通る
- 内部23画面のヘッダー・フッター・sticky・4幅を E2E で固定できる（環境があれば）
- 仕様反映受領書が記録されている

## 6. 正本リンク

- 体験契約: `hiragaunsou-vehicle-pl-extracted/docs/product/T2-experience-spec.md`
- 情報設計: `hiragaunsou-vehicle-pl-extracted/docs/product/T6-information-architecture.md`
- 画面作法: `hiragaunsou-vehicle-pl-extracted/docs/product/T7-ui-conventions.md`
- 部品カタログ: `hiragaunsou-vehicle-pl-extracted/docs/design-system-components.md`
- 受領書: `docs/features/feat-ui-ux-consistency/spec-reflection-receipt.md`
