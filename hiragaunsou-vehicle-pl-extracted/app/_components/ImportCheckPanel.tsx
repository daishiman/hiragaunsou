"use client";

import Link from "next/link";
import type { FileImportVerdict } from "../../src/domain/rules/fileImportCheck";
import { selectableYearMonths } from "../_lib/yearMonth";

/** YYYY-MM を「2026年5月」の業務の言葉にする。 */
function describeYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return `${year}年${Number(month)}月`;
}

/**
 * 取込前の確認パネル(全画面共通)。
 *
 * 月次データ取込・車両マスタ・運転者マスタで同じ見た目・同じ言い回しにするため、
 * 文章は src/domain/rules/fileImportCheck.ts が組み立て、ここは並べるだけにする。
 * 画面ごとに文言を書くと、同じ状況が画面によって違う意味に読めてしまう。
 * 仕様は docs/product/file-import-common-spec.md。
 *
 * 色は「注意」の面(caution)で描く。取り違えは失敗ではなく確認事項であり、
 * 赤一色にすると毎月出る確認に慣れて読み飛ばされる。
 */
export function ImportCheckPanel({
  fileName,
  verdict,
  yearMonth,
  onYearMonthChange,
  onConfirm,
  onCancel,
  busy = false,
}: {
  fileName: string;
  verdict: FileImportVerdict;
  /** 年月を選び直すときの現在値 */
  yearMonth: string;
  onYearMonthChange: (yearMonth: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const heading = verdict.issues[0]?.title ?? "取り込む内容の確認";
  /*
    年月が読めなかったときの本文は、判定根拠(basis)を先頭に含んだ文になっている。
    その下でもう一度 basis を出すため、まったく同じ一文が2回並んでいた。
    根拠は「なぜそう判定したか」として最後にまとめて出す方が読みやすいので、
    本文側の重複した先頭だけを落とす。判定ロジックには触れず、表示の重複を消すだけ。
  */
  function bodyWithoutBasis(body: string): string {
    if (verdict.basis && body.startsWith(verdict.basis)) {
      return body.slice(verdict.basis.length);
    }
    return body;
  }

  return (
    <div className="mt-4 rounded-lg border border-caution-border bg-caution-soft p-4" role="status">
      <p className="text-sm font-bold text-ink">{heading}</p>
      <p className="mt-1 text-xs leading-5 text-ink-muted">
        {fileName}（{verdict.summary}）
      </p>

      {verdict.issues.map((issue, index) => (
        <div key={issue.kind} className="mt-2">
          {index > 0 ? <p className="text-sm font-bold text-ink">{issue.title}</p> : null}
          <p className="text-xs leading-5 text-ink">{bodyWithoutBasis(issue.body)}</p>
          {issue.link ? (
            <Link
              href={issue.link.href}
              className="pressable mt-2 inline-flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-brand-deep hover:bg-brand-soft"
            >
              {issue.link.label} →
            </Link>
          ) : null}
        </div>
      ))}

      {/* 何を根拠にそう判定したかを必ず添える。判定の当たり外れを人が確かめられるようにする。 */}
      {verdict.basis ? (
        <p className="mt-2 text-xs leading-5 text-ink-muted">{verdict.basis}</p>
      ) : null}

      {verdict.needsYearMonthChoice ? (
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-ink">
          取り込む年月
          <select
            value={yearMonth}
            disabled={busy}
            onChange={(e) => onYearMonthChange(e.target.value)}
            className="rounded-md border border-line bg-white px-2 py-1 text-sm font-normal text-ink"
          >
            {selectableYearMonths(25).map((ym) => (
              <option key={ym} value={ym}>
                {describeYearMonth(ym)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {verdict.status === "confirm" && verdict.confirmLabel ? (
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-md bg-brand-deep px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {verdict.needsYearMonthChoice
              ? `${describeYearMonth(yearMonth)}分として取り込む`
              : verdict.confirmLabel}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
        >
          やめる
        </button>
      </div>
    </div>
  );
}
