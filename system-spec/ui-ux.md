---
status: confirmed
category: ui-ux
serves_goals: [G1, G2, G3]
---

# UI/UX 契約

## 確定内容（2026-08-11 / feat-ui-ux-consistency）

### 用語

- 1概念1語。収支表の項目名だけ元 Excel の言い回しを正とする。
- 内部 enum / 英語キーを利用者向け画面へ raw で出さない。未知値は安全な日本語へ変換する。
- 正本: `hiragaunsou-vehicle-pl-extracted/docs/product/T7-ui-conventions.md` §1

### 骨格と sticky

| 段 | 内容 | 位置 |
|---|---|---|
| 1 | アプリヘッダー | sticky top-0 |
| 2 | 工程帯（締め画面） | sticky under header |
| 3 | 絞り込み・件数帯 | sticky under step when present |
| 4 | 本文 | flow |
| 5 | 表の列見出し | 表箱内 sticky（maxHeight がある対話型表） |
| 6 | 主要操作 | sticky bottom |

工程帯がある画面の絞り込み帯は `below="stepHeader"` を必須とし、実矩形の重なりを E2E で検出する。

### 器の選び方

- 列をまたいで見比べる → 表 (`DataTable`)
- 1件を読んで判定する → 定義リスト / 判定カード
- 1件編集を横表にしない（車両詳細の上書きは縦フォーム）

### 画面体験契約の継承

T2 のアーキタイプ既定を全23内部画面が継承する。詳細契約の重複転記はしない。

正本:

- T2: `hiragaunsou-vehicle-pl-extracted/docs/product/T2-experience-spec.md`
- T6: `hiragaunsou-vehicle-pl-extracted/docs/product/T6-information-architecture.md`
- T7: `hiragaunsou-vehicle-pl-extracted/docs/product/T7-ui-conventions.md`
