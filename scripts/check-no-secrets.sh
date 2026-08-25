#!/usr/bin/env sh
# コミットしようとしている中身に、鍵の実物が混ざっていないか見る。
#
# 一度コミットした鍵は、あとで消しても履歴に残る。GitHub へ push すれば
# 取り消しは効かない。だから「気をつける」ではなく、通れない道にしておく。
#
# 見るのはステージ済みの中身だけ。作業中のファイルまで見ると、
# まだコミットしていない下書きで止まってしまう。
set -eu

# 鍵の形: hgcc_ + 43文字前後の base64url。
# 桁数を指定するのは、説明文の中の「hgcc_」や「hgcc_… 」で止めないため。
PATTERN='hgcc_[A-Za-z0-9_-]\{20,\}'

# 検査から外すもの。
#   - このスクリプト自身 (上に鍵の形そのものが書いてある)
#   - .env.improvement 系 (そもそも追跡していないが、名前で二重に外しておく)
staged=$(git diff --cached --name-only --diff-filter=ACM |
  grep -v '^scripts/check-no-secrets\.sh$' |
  grep -v '\.env\.improvement' || true)

[ -z "$staged" ] && exit 0

found=""
for file in $staged; do
  [ -f "$file" ] || continue
  if git show ":$file" 2>/dev/null | grep -q "$PATTERN"; then
    found="$found  $file
"
  fi
done

if [ -n "$found" ]; then
  cat >&2 <<MSG
コミットを止めました。次のファイルに鍵らしき文字列 (hgcc_…) が入っています。

$found
鍵はソースにも設定ファイルにも書かないでください。置き場所は次のどちらかです。

  - 1Password (おすすめ)。.env.improvement には op:// の指し先だけを書く
  - 環境変数。コマンドの前に付けて渡す

すでにこの鍵が外へ出た可能性があるなら、管理画面の
  /admin/improvements/tokens
から失効させて、新しい鍵を発行し直してください。
MSG
  exit 1
fi
