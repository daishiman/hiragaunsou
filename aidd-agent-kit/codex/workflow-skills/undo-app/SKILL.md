---
name: undo-app
description: 公開済みWebアプリの直前の変更を、履歴を消さずに安全に取り消して再公開する。Codexで「前の状態に戻して」「変更を取り消して」「$undo-app」と依頼されたときに使用する。
---

# Undo app change

1. 最初に `$solo-git-flow` を使用し、同スキルの§7にある取り消し手順を確認する。
2. `git log --oneline` とリリースタグから戻す対象を特定する。曖昧なら直近3件以内を業務の言葉で示して選んでもらう。
3. 必ず `git revert` を使う。`git reset --hard` と `push --force` は使用しない。
4. データベース変更を含む場合はバックアップの有無を確認し、データも戻すか画面とコードだけを戻すか利用者に確認する。
5. 対象コミットをrevertした後、`pnpm run preview` で戻った状態を確認し、mainへ反映して `wrangler deploy` を行い、本番URLを確認する。
6. 「1つ前の状態に戻しました」、確認用URL、戻した内容の順で、git用語を使わず報告する。
