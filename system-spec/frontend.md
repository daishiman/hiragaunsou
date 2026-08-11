---
status: confirmed
category: frontend
serves_goals: [G1, G3]
---

# フロントエンド契約

## 画面 SSOT

- 画面名・lead・does・工程順・権限: `app/_lib/screens.ts` + `screens.catalog.ts`
- ナビ導出: `app/_lib/navigation.ts`（薄い詰め替えのみ）
- ページヘッダ: `ScreenHeader` 経由のみ（印刷帳票は例外）

## 表示ラベル SSOT

| 対象 | ファイル |
|---|---|
| 収支表項目 | `app/_lib/fieldLabels.ts` |
| 重大さ | `app/_lib/severity.ts` |
| 赤字要因 | `app/_lib/factorLabels.ts` |
| 帳票種別・利用種別・取込状態 | `app/_lib/kindLabels.ts` |

## 部品

実装カタログ: `hiragaunsou-vehicle-pl-extracted/docs/design-system-components.md`

新規流派を画面内に直書きしない。必要な見た目は部品へ上げる。

## 期間の二系統

- **業務の対象年月**: 収支表・取込など業務データの月
- **AI利用の暦月**: `/usage` は日本時間の暦月で集計し、業務の対象年月と別であることを画面に明示する
