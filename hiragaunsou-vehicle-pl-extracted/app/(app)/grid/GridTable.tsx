"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { VehiclePlField } from "../../../src/domain/entities/VehiclePl";
import type { GridReviewSummary, GridRow } from "../../../src/usecase/steps/getMonthlyGrid";
import {
  heaviestSeverity,
  type ReviewSeverity,
  type VehiclePlIssue,
} from "../../../src/domain/rules/vehiclePlReview";
import { FIELD_LABELS, isNumericField } from "../../_lib/fieldLabels";
import { kmPriceLabel, num, pct, yen } from "../../_lib/format";

/** 重さごとの見え方。面の色だけで区別せず、凡例の語と1対1で対応させる。 */
const SEVERITY_STYLE: Record<ReviewSeverity, { cell: string; chip: string; label: string }> = {
  blocking: {
    cell: "border border-danger-border bg-danger-soft",
    chip: "border-danger-border bg-danger-soft text-danger",
    label: "要修正",
  },
  warning: {
    cell: "border border-caution-border bg-caution-soft",
    chip: "border-caution-border bg-caution-soft text-ink",
    label: "要確認",
  },
  info: {
    cell: "border border-brand-soft bg-brand-mist",
    chip: "border-brand-soft bg-brand-mist text-brand-deep",
    label: "参考",
  },
};

function heaviestOf(issues: readonly VehiclePlIssue[]): ReviewSeverity {
  return heaviestSeverity(issues) ?? "info";
}

function formatIssueValue(value: number | string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return Number.isInteger(value) ? num(value) : num(value, 2);
  return value;
}

/** 疑似列: km単価 (= 運送収入 / 稼働Km)。DBには持たず表示時に算出する。 */
const KM_PRICE = "_kmPrice";
type ColumnKey = VehiclePlField | typeof KM_PRICE;

/** Excel互換の全列表示 (モック GROUPS_FULL に、実装側にしか無い列を加えたもの) */
const GROUPS_FULL: readonly { label: string; cols: readonly ColumnKey[] }[] = [
  { label: "車両情報", cols: ["no", "type", "depot", "reg", "code", "driver"] },
  { label: "稼働", cols: ["trips", "slips", "hours", "km"] },
  { label: "売上", cols: ["fare", "fee", "sales"] },
  { label: "運行費", cols: ["toll", "tollDisc", "tollNet"] },
  {
    label: "燃料費",
    cols: ["fuelIn", "fuelInQty", "fuelOut", "fuelOutQty", "fuelQty", "nempi", "adblue", "fuelTotal"],
  },
  { label: "修繕費", cols: ["repair", "tire", "equip", "mainte", "repairTotal"] },
  { label: "人件費", cols: ["salary", "bonus", "welfare", "laborTotal"] },
  { label: "保険料", cols: ["insCompulsory", "insVoluntary", "insTotal"] },
  { label: "賦課税", cols: ["taxAuto", "taxWeight", "taxTotal"] },
  { label: "諸経費", cols: ["miscOther", "miscTotal"] },
  { label: "運送費", cols: ["lease", "installment", "transportTotal"] },
  { label: "管理費", cols: ["adminFee", "adminTotal"] },
  { label: "合計", cols: ["fixed", "variable", "expense"] },
  { label: "指標", cols: ["profit", "margin", KM_PRICE] },
];

/** 既定の要約表示 (認知負荷を下げるため15列に絞る) */
const GROUPS_SUMMARY: readonly { label: string; cols: readonly ColumnKey[] }[] = [
  { label: "車両情報", cols: ["no", "type", "depot", "driver"] },
  { label: "稼働", cols: ["trips", "km"] },
  { label: "売上", cols: ["sales"] },
  { label: "主な経費(計)", cols: ["tollNet", "fuelTotal", "repairTotal", "laborTotal"] },
  { label: "合計", cols: ["expense"] },
  { label: "指標", cols: ["profit", "margin", KM_PRICE] },
];

/** 要約表示のとき、詳細列に付いた異常フラグをどの親列に代表させるか */
const PARENT: Record<string, ColumnKey> = {
  fuelIn: "fuelTotal",
  fuelInQty: "fuelTotal",
  fuelOut: "fuelTotal",
  fuelOutQty: "fuelTotal",
  fuelQty: "fuelTotal",
  adblue: "fuelTotal",
  repair: "repairTotal",
  tire: "repairTotal",
  equip: "repairTotal",
  mainte: "repairTotal",
  salary: "laborTotal",
  bonus: "laborTotal",
  welfare: "laborTotal",
  toll: "tollNet",
  tollDisc: "tollNet",
  slips: "km",
  hours: "km",
};

/** 合計行を出す列 (件数・比率・単価は単純合計できないので除く) */
const SUMMABLE = new Set<string>([
  "trips",
  "slips",
  "hours",
  "km",
  "fare",
  "fee",
  "sales",
  "toll",
  "tollDisc",
  "tollNet",
  "fuelIn",
  "fuelInQty",
  "fuelOut",
  "fuelOutQty",
  "fuelQty",
  "adblue",
  "fuelTotal",
  "repair",
  "tire",
  "equip",
  "mainte",
  "repairTotal",
  "salary",
  "bonus",
  "welfare",
  "laborTotal",
  "insCompulsory",
  "insVoluntary",
  "insTotal",
  "taxAuto",
  "taxWeight",
  "taxTotal",
  "miscOther",
  "miscTotal",
  "lease",
  "installment",
  "transportTotal",
  "adminFee",
  "adminTotal",
  "fixed",
  "variable",
  "expense",
  "profit",
]);

const QTY_DIGITS: Record<string, number> = { km: 1, hours: 1, nempi: 2 };

function labelOf(col: ColumnKey): string {
  if (col === KM_PRICE) return "km単価";
  return FIELD_LABELS[col];
}

function rawValue(row: GridRow, col: ColumnKey): number | string | null {
  if (col === KM_PRICE) {
    const km = Number(row.values.km);
    const sales = Number(row.values.sales);
    if (!Number.isFinite(km) || km <= 0) return null;
    return sales / km;
  }
  return row.values[col];
}

function formatCell(col: ColumnKey, value: number | string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  if (col === KM_PRICE) return kmPriceLabel(Number(value));
  if (!isNumericField(col as VehiclePlField)) return String(value);
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (col === "margin") return pct(n);
  const digits = QTY_DIGITS[col];
  if (digits !== undefined) return num(n, digits);
  if (col === "trips" || col === "slips") return num(n);
  return yen(n);
}

function isTextColumn(col: ColumnKey): boolean {
  return col !== KM_PRICE && !isNumericField(col as VehiclePlField);
}

/**
 * S2 月次収支表 (モック view-grid.js に対応)。
 * 既定は要約15列。Excel互換の全列はセグメント切替で開示する(段階的開示)。
 * 所属・車種・赤字のみのフィルタ、合計行、車両ドリルダウンを備える。
 */
export function GridTable({
  rows,
  yearMonth,
  review,
}: {
  rows: GridRow[];
  yearMonth: string;
  review: GridReviewSummary;
}) {
  const [mode, setMode] = useState<"summary" | "full">("summary");
  const [depot, setDepot] = useState("");
  const [type, setType] = useState("");
  const [deficitOnly, setDeficitOnly] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  /** 開いている所見。表の下に判断材料を出すため、セルの位置だけを持つ。 */
  const [opened, setOpened] = useState<{ vehicleNo: string; field: string } | null>(null);

  const depots = useMemo(
    () => Array.from(new Set(rows.map((r) => String(r.values.depot ?? "")).filter(Boolean))).sort(),
    [rows],
  );
  const types = useMemo(
    () => Array.from(new Set(rows.map((r) => String(r.values.type ?? "")).filter(Boolean))).sort(),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (depot && String(r.values.depot ?? "") !== depot) return false;
        if (type && String(r.values.type ?? "") !== type) return false;
        if (deficitOnly && Number(r.values.profit ?? 0) >= 0) return false;
        // 「参考」しか付いていない車両は確認の手を止める必要が無いので、絞り込みでは残さない。
        if (reviewOnly && !r.issues.some((i) => i.severity !== "info")) return false;
        return true;
      }),
    [rows, depot, type, deficitOnly, reviewOnly],
  );

  const groups = mode === "full" ? GROUPS_FULL : GROUPS_SUMMARY;
  const columns = useMemo(() => groups.flatMap((g) => g.cols), [groups]);

  const totals = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const row of filtered) {
      for (const col of columns) {
        if (!SUMMABLE.has(col)) continue;
        const v = Number(rawValue(row, col));
        if (Number.isFinite(v)) acc[col] = (acc[col] ?? 0) + v;
      }
    }
    return acc;
  }, [filtered, columns]);

  /**
   * セルごとの所見。要約表示では詳細列に付いた所見を親列に寄せて、
   * 列を畳んだ瞬間に印が消えてしまわないようにする(消えると見落としになる)。
   */
  const issuesByCell = (row: GridRow): Map<string, VehiclePlIssue[]> => {
    const map = new Map<string, VehiclePlIssue[]>();
    const add = (key: string, issue: VehiclePlIssue) => {
      const list = map.get(key) ?? [];
      list.push(issue);
      map.set(key, list);
    };
    for (const issue of row.issues) {
      add(issue.field, issue);
      if (mode === "summary" && PARENT[issue.field]) add(PARENT[issue.field] as string, issue);
    }
    return map;
  };

  const openedRow = opened ? filtered.find((r) => r.vehicleNo === opened.vehicleNo) ?? null : null;
  const openedIssues = openedRow && opened ? (issuesByCell(openedRow).get(opened.field) ?? []) : [];

  const totalKmPrice =
    (totals.km ?? 0) > 0 ? (totals.sales ?? 0) / (totals.km as number) : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-line bg-white p-0.5" role="group">
          {(["summary", "full"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded px-3 py-1.5 text-xs font-semibold ${
                mode === m ? "bg-brand-soft text-brand-deep" : "text-ink-muted hover:bg-subtle"
              }`}
            >
              {m === "summary" ? "要約(15列)" : "Excel互換(全列)"}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          所属
          <select
            value={depot}
            onChange={(e) => setDepot(e.target.value)}
            className="rounded-md border border-line bg-white px-2 py-1 text-sm text-ink"
          >
            <option value="">すべて</option>
            {depots.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          車種
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-md border border-line bg-white px-2 py-1 text-sm text-ink"
          >
            <option value="">すべて</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-ink">
          <input
            type="checkbox"
            checked={deficitOnly}
            onChange={(e) => setDeficitOnly(e.target.checked)}
            className="size-4"
          />
          赤字のみ
        </label>

        <label className="flex items-center gap-1.5 text-xs text-ink">
          <input
            type="checkbox"
            checked={reviewOnly}
            onChange={(e) => setReviewOnly(e.target.checked)}
            className="size-4"
          />
          確認が必要な車両のみ
        </label>

        <p className="num ml-auto text-xs text-ink-muted">
          {filtered.length} / {rows.length} 台
        </p>
      </div>

      <ReviewSummaryBar review={review} vehicleCount={rows.length} />

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="min-w-max border-collapse text-xs">
          <thead>
            <tr className="border-b border-line bg-subtle text-ink-muted">
              {groups.map((g) => (
                <th
                  key={g.label}
                  colSpan={g.cols.length}
                  className="border-l border-line px-3 py-1.5 text-center text-[11px] font-semibold first:border-l-0"
                >
                  {g.label}
                </th>
              ))}
            </tr>
            <tr className="border-b border-line bg-subtle text-ink-muted">
              {columns.map((col) => (
                <th
                  key={col}
                  className={`whitespace-nowrap px-3 py-2 font-medium ${isTextColumn(col) ? "text-left" : "text-right"} ${col === "no" ? "sticky left-0 z-10 bg-subtle" : ""}`}
                >
                  {labelOf(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const cellIssues = issuesByCell(row);
              const profit = Number(row.values.profit ?? 0);
              return (
                <tr key={row.vehicleNo} className="border-b border-line last:border-b-0 hover:bg-subtle">
                  {columns.map((col) => {
                    const value = rawValue(row, col);
                    const issues = cellIssues.get(col) ?? [];
                    const severity = issues.length > 0 ? heaviestOf(issues) : null;
                    const isOpen =
                      opened?.vehicleNo === row.vehicleNo && opened.field === col;
                    if (col === "no") {
                      return (
                        <td
                          key={col}
                          className={`sticky left-0 z-10 whitespace-nowrap px-3 py-2 ${row.severity === "blocking" ? "bg-danger-soft" : "bg-white"}`}
                        >
                          <Link
                            href={`/vehicle/${encodeURIComponent(row.vehicleNo)}?ym=${yearMonth}`}
                            className="num font-semibold text-brand-deep hover:underline"
                          >
                            {row.vehicleNoLabel ?? row.vehicleNo}
                          </Link>
                        </td>
                      );
                    }
                    const content = formatCell(col, value);
                    return (
                      <td
                        key={col}
                        className={[
                          "whitespace-nowrap px-3 py-2",
                          isTextColumn(col) ? "text-left" : "num text-right",
                          col === "profit" && profit < 0 ? "font-bold text-danger" : "",
                          severity ? SEVERITY_STYLE[severity].cell : "",
                          isOpen ? "outline outline-2 outline-brand" : "",
                        ].join(" ")}
                      >
                        {severity ? (
                          <button
                            type="button"
                            onClick={() =>
                              setOpened(isOpen ? null : { vehicleNo: row.vehicleNo, field: col })
                            }
                            aria-expanded={isOpen}
                            title={issues[0]?.title}
                            className="w-full text-inherit underline decoration-dotted underline-offset-2"
                          >
                            {content}
                          </button>
                        ) : (
                          content
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-subtle font-bold">
              {columns.map((col) => {
                if (col === "no") {
                  return (
                    <td key={col} className="sticky left-0 z-10 bg-subtle px-3 py-2">
                      合計
                    </td>
                  );
                }
                if (col === KM_PRICE) {
                  return (
                    <td key={col} className="num px-3 py-2 text-right">
                      {kmPriceLabel(totalKmPrice)}
                    </td>
                  );
                }
                if (col === "margin") {
                  const sales = totals.sales ?? 0;
                  return (
                    <td key={col} className="num px-3 py-2 text-right">
                      {sales > 0 ? pct((totals.profit ?? 0) / sales) : "—"}
                    </td>
                  );
                }
                if (!SUMMABLE.has(col)) {
                  return <td key={col} className="px-3 py-2" />;
                }
                return (
                  <td
                    key={col}
                    className={`num px-3 py-2 text-right ${col === "profit" && (totals.profit ?? 0) < 0 ? "text-danger" : ""}`}
                  >
                    {formatCell(col, totals[col] ?? 0)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {openedRow && openedIssues.length > 0 ? (
        <IssuePanel
          vehicleNo={openedRow.vehicleNo}
          field={opened!.field}
          issues={openedIssues}
          onClose={() => setOpened(null)}
        />
      ) : (
        <p className="mt-3 text-xs text-ink-muted">
          色の付いたセルを押すと、なぜ確認が必要なのかと、判断のための比較値が下に出ます。
          車番を押すと、その車両の経費内訳・12ヶ月推移・実力損益を確認できます。
        </p>
      )}
    </>
  );
}

/**
 * 「今月あと何を見ればよいか」を件数で先に示す。
 * 表を上から全部見る運用に戻さないための入口で、ここが空なら確認作業は終わっている。
 */
function ReviewSummaryBar({
  review,
  vehicleCount,
}: {
  review: GridReviewSummary;
  vehicleCount: number;
}) {
  const total = review.blocking + review.warning;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5">
      {total === 0 ? (
        <p className="text-sm font-semibold text-ink">
          確認が必要な箇所はありません。{vehicleCount}台すべてこのまま確定できます。
        </p>
      ) : (
        <>
          <p className="text-sm text-ink">
            <span className="font-semibold">{total}件</span>だけ確認してください。
            残り{review.cleanVehicles}台は指摘なしです。
          </p>
          {(["blocking", "warning", "info"] as const).map((severity) => {
            const count = review[severity];
            if (count === 0) return null;
            return (
              <span
                key={severity}
                className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${SEVERITY_STYLE[severity].chip}`}
              >
                {SEVERITY_STYLE[severity].label} {count}
              </span>
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * 指摘の中身。「印が付いている」だけでは人はOK/NGを決められないので、
 * 何と比べてそう判断したのかを値で並べ、直しに行く先も一緒に置く。
 */
function IssuePanel({
  vehicleNo,
  field,
  issues,
  onClose,
}: {
  vehicleNo: string;
  field: string;
  issues: VehiclePlIssue[];
  onClose: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-white p-4">
      <div className="flex items-start gap-3">
        <h3 className="text-sm font-bold text-ink">
          車番 {vehicleNo} ／ {FIELD_LABELS[field as VehiclePlField] ?? field}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded border border-line px-2 py-0.5 text-xs text-ink-muted hover:bg-subtle"
        >
          閉じる
        </button>
      </div>

      <ul className="mt-3 space-y-3">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_STYLE[issue.severity].chip}`}
              >
                {SEVERITY_STYLE[issue.severity].label}
              </span>
              <span className="text-sm font-semibold text-ink">{issue.title}</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{issue.reason}</p>

            {issue.comparisons.length > 0 && (
              <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                {issue.comparisons.map((comparison) => (
                  <div key={comparison.label} className="flex items-baseline gap-1.5">
                    <dt className="text-[11px] text-ink-muted">{comparison.label}</dt>
                    <dd className="num text-xs font-semibold text-ink">
                      {formatIssueValue(comparison.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {issue.fix && (
              <Link
                href={issue.fix.href}
                className="mt-2 inline-block text-xs font-semibold text-brand-deep hover:underline"
              >
                {issue.fix.label} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
