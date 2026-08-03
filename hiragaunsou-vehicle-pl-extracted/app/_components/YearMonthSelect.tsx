"use client";

import { useRouter } from "next/navigation";

/** 年月切り替えセレクタ。選択するとURLの ?ym= を書き換えてServer Componentを再取得させる。 */
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
        onChange={(e) => router.push(`${basePath}?ym=${e.target.value}`)}
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
