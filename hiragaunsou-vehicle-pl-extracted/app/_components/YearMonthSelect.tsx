"use client";

import { useRouter } from "next/navigation";
import { requestLeave } from "./editForm/navigationGuard";

/**
 * 年月切り替えセレクタ。選択するとURLの ?ym= を書き換えてServer Componentを再取得させる。
 *
 * 保存していない入力がある画面では、移動する前に確認を挟む (editForm/navigationGuard)。
 * 確認を出すかどうかは編集フォーム側が決めるので、この部品は関所を通すだけにする。
 * 関所に誰も登録していない画面 (これまで通りの画面) では、そのまま移動する。
 */
export function YearMonthSelect({
  basePath,
  value,
  options,
}: {
  basePath: string;
  value: string;
  options: string[];
}) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-xs text-ink-muted">
      対象年月
      <select
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          const moved = requestLeave(() => router.push(`${basePath}?ym=${next}`));
          // 引き止められたときは、選び直した表示を元の月へ戻す
          // (移動していないのに別の月が選ばれて見えると、どの月を見ているのか分からなくなる)。
          if (!moved) e.currentTarget.value = value;
        }}
        className="rounded-md border border-line bg-white px-2 py-1 text-sm text-ink focus-visible:outline-2"
      >
        {options.map((ym) => (
          <option key={ym} value={ym}>
            {ym}
          </option>
        ))}
      </select>
    </label>
  );
}
