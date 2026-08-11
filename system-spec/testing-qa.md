---
status: confirmed
category: testing-qa
serves_goals: [G3]
---

# テスト / 品質保証契約

## MVP の最小ゲート（本 feature）

| ゲート | コマンド | 合格条件 |
|---|---|---|
| 型 | `npm run typecheck` | exit 0 |
| lint | `npm run lint` | error 0（既存 warning は許容） |
| unit/component | `npm test` または変更対象の focused vitest | 失敗 0 |

## 画面一貫性の固定

- inventory: `tests/lib/screenInventory.test.ts` — 内部 route と `SCREENS` の双方向
- 語彙: `tests/lib/uiVocabulary.test.ts` — 禁止語・旧語の回帰
- sticky / 4幅: `tests/e2e/screen-consistency.spec.ts`（Workers preview があるとき）

## 非目標（MVP）

- 全ブラウザ実機網羅
- カバレッジ閾値の引き上げ
- 本番デプロイ smoke（別 release 作業）
