---
kind: index
project: hiragaunsou-vehicle-pl
---

# システム構築仕様書 index（車両別収支管理）

本ディレクトリは Harness 正規フロー向けの system-spec 層。
業務・画面の詳細正本はアプリ内 `hiragaunsou-vehicle-pl-extracted/docs/product/` に置き、ここは横断契約と索引を持つ。

## 章一覧

| カテゴリ | 章 | 状態 | 対応するアプリ正本 |
|---|---|---|---|
| 要件 | [requirements.md](./requirements.md) | confirmed | T1-requirements.md |
| UI/UX | [ui-ux.md](./ui-ux.md) | confirmed | T2 / T6 / T7 / design-system |
| フロントエンド | [frontend.md](./frontend.md) | confirmed | design-system-components / screens |
| テスト | [testing-qa.md](./testing-qa.md) | confirmed | testing-strategy / e2e inventory |

## 実装 writeback

- 2026-08-11: `feat-ui-ux-consistency` — 用語・sticky・器・inventory を T2/T6/T7 と同期
- 受領書: `docs/features/feat-ui-ux-consistency/spec-reflection-receipt.md`
