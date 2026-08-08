"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { VEHICLE_PL_FIELDS, type VehiclePlField } from "../../../src/domain/entities/VehiclePl";
import type { GridReviewSummary, GridRow } from "../../../src/usecase/steps/getMonthlyGrid";
import type { ReviewedIssue } from "../../../src/domain/rules/plIssueAck";
import {
  OVERRIDABLE_FIELDS,
  OVERRIDABLE_FIELD_META,
  type OverridableField,
} from "../../../src/domain/rules/vehiclePlOverride";
import { heaviestSeverity, type ReviewSeverity } from "../../../src/domain/rules/vehiclePlReview";
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

/** 確認済みにした指摘の見え方。色を落として「もう見なくてよい」ことを面で示す。 */
const ACKED_CELL = "border border-line bg-subtle text-ink-muted";

function formatIssueValue(value: number | string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return Number.isInteger(value) ? num(value) : num(value, 2);
  return value;
}

/** 疑似列: km単価 (= 運送収入 / 稼働Km)。DBには持たず表示時に算出する。 */
const KM_PRICE = "_kmPrice";
type ColumnKey = VehiclePlField | typeof KM_PRICE;

/**
 * 表の上で直せる項目。
 *
 * 直せるのは「計算の入口の値」だけで、損益・経費計・各小計は必ず再計算で作られる
 * (domain/rules/vehiclePlOverride.ts)。そのうち収支表の列として存在するものだけが
 * ここに残る。乗務員数・賞与(月額)は列が無いので、従来どおり車両詳細画面で直す。
 */
const EDITABLE_FIELDS = OVERRIDABLE_FIELDS.filter((field) =>
  (VEHICLE_PL_FIELDS as readonly string[]).includes(field),
) as readonly OverridableField[];

const EDITABLE = new Set<string>(EDITABLE_FIELDS);

/** 収支表の列として存在し、かつ直せる項目 */
type EditableColumn = Extract<OverridableField, VehiclePlField>;

/** 小数を許す項目 (それ以外は整数で受ける)。単位はマスタ側のメタに持たせてある。 */
const DECIMAL_FIELDS = new Set<string>(["km", "hours"]);

function isEditableField(col: ColumnKey): col is EditableColumn {
  return EDITABLE.has(col);
}

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
 * 画面の中だけで持つ、その車両への直し。
 *
 * 保存はすぐ済ませる (閉じても消えない) が、収支表への反映は「まとめて反映」まで待つ。
 * そのため保存した値は表に載っておらず、ここに重ねて表示する必要がある。
 */
interface VehicleEdit {
  values: Partial<Record<OverridableField, number>>;
  /** 保存後の最終更新時刻。次の保存でそのまま送り返して競合の誤判定を防ぐ */
  updatedAt: number | null;
  reason: string;
}

interface AckState {
  acknowledged: boolean;
  ackedByName: string | null;
}

/**
 * S2 月次収支表 (モック view-grid.js に対応)。
 *
 * 既定は要約15列。Excel互換の全列はセグメント切替で開示する(段階的開示)。
 * 指摘の付いたセルはその場で直せ、直さずに通す判断は「確認済み」として残す。
 * 収支表への反映(再計算)は溜めて1回だけ走らせる。
 */
export function GridTable({
  rows,
  yearMonth,
  review,
  canEdit,
  lockedReason,
}: {
  rows: GridRow[];
  yearMonth: string;
  review: GridReviewSummary;
  /** 数字を直したり確認済みにしたりできるか (閲覧のみの人・確定済みの月では false) */
  canEdit: boolean;
  /** 直せない場合の理由。画面にそのまま出す */
  lockedReason: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"summary" | "full">("summary");
  const [depot, setDepot] = useState("");
  const [type, setType] = useState("");
  const [deficitOnly, setDeficitOnly] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  /** 開いている所見。表の下に判断材料を出すため、セルの位置だけを持つ。 */
  const [opened, setOpened] = useState<{ vehicleNo: string; field: string } | null>(null);

  /**
   * サーバから来た表に重ねる、この画面で直した内容。
   * 反映(再計算)するまでサーバ側の表は古い値のままなので、重ねないと直した結果が見えない。
   */
  const [edits, setEdits] = useState<Record<string, VehicleEdit>>({});
  const [acks, setAcks] = useState<Record<string, AckState>>({});
  const [pendingCount, setPendingCount] = useState(review.pendingOverrides);
  const [notice, setNotice] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  /** 直前の直しの、1つ前の状態 (「元に戻す」で書き戻す) */
  const [undo, setUndo] = useState<{
    vehicleNo: string;
    values: Partial<Record<OverridableField, number>>;
    reason: string;
  } | null>(null);

  // 表を取り直したら重ねていた内容は不要になる (サーバ側の表に入っている)。
  // ここで捨てないと、反映後も古い「反映待ち」の印が残り続ける。
  // 描画中に捨てるのは、捨てる前の状態を一度描いてちらつかせないため。
  const [shownRows, setShownRows] = useState(rows);
  if (shownRows !== rows) {
    setShownRows(rows);
    setEdits({});
    setAcks({});
    setUndo(null);
    setPendingCount(review.pendingOverrides);
  }

  const depots = useMemo(
    () => Array.from(new Set(rows.map((r) => String(r.values.depot ?? "")).filter(Boolean))).sort(),
    [rows],
  );
  const types = useMemo(
    () => Array.from(new Set(rows.map((r) => String(r.values.type ?? "")).filter(Boolean))).sort(),
    [rows],
  );

  /** 確認済みの印を重ねた指摘。件数・セルの色・パネルの表示はすべてこれを見る。 */
  const issuesOf = (row: GridRow): ReviewedIssue[] =>
    row.issues.map((issue) => {
      const local = acks[issue.key];
      if (!local) return issue;
      return {
        ...issue,
        acknowledged: local.acknowledged,
        ack: local.acknowledged
          ? { note: null, ackedAt: Date.now(), ackedByName: local.ackedByName }
          : null,
      };
    });

  const openIssuesOf = (row: GridRow) => issuesOf(row).filter((i) => !i.acknowledged);

  /** 直した値を重ねた、いま画面に出すべき値 */
  const valueOf = (row: GridRow, col: ColumnKey): number | string | null => {
    if (col === KM_PRICE) {
      const km = Number(valueOf(row, "km"));
      const sales = Number(row.values.sales);
      if (!Number.isFinite(km) || km <= 0) return null;
      return sales / km;
    }
    const edited = isEditableField(col) ? edits[row.vehicleNo]?.values[col] : undefined;
    if (edited !== undefined) return edited;
    return row.values[col];
  };

  /** この画面で直したか、保存済みだがまだ反映していない値か */
  const isPendingCell = (row: GridRow, col: ColumnKey): boolean => {
    if (!isEditableField(col)) return false;
    if (edits[row.vehicleNo]?.values[col] !== undefined) return true;
    return row.override?.pending === true && row.override.values[col] !== undefined;
  };

  const lockOf = (row: GridRow): number | null =>
    edits[row.vehicleNo]?.updatedAt ?? row.override?.updatedAt ?? null;

  const reasonOf = (row: GridRow): string =>
    edits[row.vehicleNo]?.reason ?? row.override?.reason ?? "";

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (depot && String(r.values.depot ?? "") !== depot) return false;
        if (type && String(r.values.type ?? "") !== type) return false;
        if (deficitOnly && Number(r.values.profit ?? 0) >= 0) return false;
        // 「参考」しか付いていない車両と、確認が済んだ車両は確認の手を止める必要が無い。
        if (reviewOnly && !openIssuesOf(r).some((i) => i.severity !== "info")) return false;
        return true;
      }),
    // openIssuesOf は acks に依存する。確認済みにした瞬間に絞り込みから外れてほしい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, depot, type, deficitOnly, reviewOnly, acks],
  );

  const groups = mode === "full" ? GROUPS_FULL : GROUPS_SUMMARY;
  const columns = useMemo(() => groups.flatMap((g) => g.cols), [groups]);

  const totals = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const row of filtered) {
      for (const col of columns) {
        if (!SUMMABLE.has(col)) continue;
        const v = Number(row.values[col as VehiclePlField]);
        if (Number.isFinite(v)) acc[col] = (acc[col] ?? 0) + v;
      }
    }
    return acc;
  }, [filtered, columns]);

  /**
   * セルごとの所見。要約表示では詳細列に付いた所見を親列に寄せて、
   * 列を畳んだ瞬間に印が消えてしまわないようにする(消えると見落としになる)。
   */
  const issuesByCell = (row: GridRow): Map<string, ReviewedIssue[]> => {
    const map = new Map<string, ReviewedIssue[]>();
    const add = (key: string, issue: ReviewedIssue) => {
      const list = map.get(key) ?? [];
      list.push(issue);
      map.set(key, list);
    };
    for (const issue of issuesOf(row)) {
      add(issue.field, issue);
      if (mode === "summary" && PARENT[issue.field]) add(PARENT[issue.field] as string, issue);
    }
    return map;
  };

  /** いま画面が示している確認の進み具合 (サーバの件数に、この画面での操作を重ねたもの) */
  const progress = useMemo(() => {
    let blocking = 0;
    let warning = 0;
    let info = 0;
    let acknowledged = 0;
    for (const row of rows) {
      for (const issue of issuesOf(row)) {
        if (issue.acknowledged) {
          acknowledged += 1;
          continue;
        }
        if (issue.severity === "blocking") blocking += 1;
        else if (issue.severity === "warning") warning += 1;
        else info += 1;
      }
    }
    return { blocking, warning, info, acknowledged, cleanVehicles: review.cleanVehicles };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, acks, review.cleanVehicles]);

  const openedRow = opened ? rows.find((r) => r.vehicleNo === opened.vehicleNo) ?? null : null;
  const openedIssues = openedRow && opened ? (issuesByCell(openedRow).get(opened.field) ?? []) : [];

  const totalKmPrice = (totals.km ?? 0) > 0 ? (totals.sales ?? 0) / (totals.km as number) : null;

  /** セルの編集 */
  const [editing, setEditing] = useState<{ vehicleNo: string; field: EditableColumn } | null>(null);

  function startEdit(row: GridRow, field: EditableColumn) {
    if (!canEdit) return;
    setOpened(null);
    setEditing({ vehicleNo: row.vehicleNo, field });
  }

  function focusCell(rowIndex: number, colIndex: number) {
    document.getElementById(`gridcell-${rowIndex}-${colIndex}`)?.focus();
  }

  /** 矢印キーで、操作できるセルだけを辿って動く。 */
  function moveFocus(rowIndex: number, colIndex: number, dRow: number, dCol: number) {
    let r = rowIndex + dRow;
    let c = colIndex + dCol;
    while (r >= 0 && r < filtered.length && c >= 0 && c < columns.length) {
      if (document.getElementById(`gridcell-${r}-${c}`)) {
        focusCell(r, c);
        return;
      }
      r += dRow;
      c += dCol;
    }
  }

  /**
   * その車両の直しを丸ごと保存し直す。
   * 上書きは年月×車番で1レコードなので、1セルだけ直す場合もその車両の直し全体を送る。
   */
  async function putOverride(
    row: GridRow,
    values: Partial<Record<OverridableField, number>>,
    reason: string,
  ) {
    const res = await fetch("/api/vehicle-pl/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        yearMonth,
        vehicleNo: row.vehicleNo,
        excluded: row.override?.excluded ?? false,
        values,
        reason,
        // 直した値はすぐ保存するが、収支表の作り直しは「まとめて反映」まで待つ。
        deferRecalculation: true,
        expectedUpdatedAt: lockOf(row),
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      pendingCount?: number;
      updatedAt?: number | null;
    } | null;
    if (!res.ok) throw new Error(data?.error ?? "直した値を保存できませんでした");

    setEdits((prev) => ({
      ...prev,
      [row.vehicleNo]: { values, updatedAt: data?.updatedAt ?? null, reason },
    }));
    if (typeof data?.pendingCount === "number") setPendingCount(data.pendingCount);
  }

  async function saveEdit(row: GridRow, field: EditableColumn, value: number, reason: string) {
    const before = { ...(edits[row.vehicleNo]?.values ?? row.override?.values ?? {}) };
    const next = { ...before, [field]: value };

    await putOverride(row, next, reason);
    setEditing(null);
    // 直した直後だけ1つ前に戻せるようにする。打ち間違いに気づくのは押した直後がほとんどで、
    // ここで戻せないと理由を書き直してもう一度入力し直すことになる。
    setUndo({ vehicleNo: row.vehicleNo, values: before, reason: reasonOf(row) });
    setNotice(
      `車番${row.vehicleNoLabel} の${OVERRIDABLE_FIELD_META[field].label}を保存しました。収支表に反映するには「収支表に反映する」を押してください。`,
    );
  }

  /**
   * 直前の直しを1つ戻す。
   * 戻した先が「直し無し」の場合は上書きごと取り消す(空の直しは保存できないため)。
   * 取り消しは元に戻す操作なので結果をその場で見せる必要があり、こちらは即時に反映される。
   */
  async function undoLastEdit() {
    if (!undo) return;
    const row = rows.find((r) => r.vehicleNo === undo.vehicleNo);
    if (!row) return;

    try {
      if (Object.keys(undo.values).length === 0) {
        const res = await fetch(
          `/api/vehicle-pl/override?yearMonth=${encodeURIComponent(yearMonth)}&vehicleNo=${encodeURIComponent(row.vehicleNo)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error("元に戻せませんでした");
        setUndo(null);
        setNotice(`車番${row.vehicleNoLabel} の直しを取り消して、元の数字に戻しました。`);
        router.refresh();
        return;
      }
      await putOverride(row, undo.values, undo.reason || "直前の直しを元に戻した");
      setUndo(null);
      setNotice(`車番${row.vehicleNoLabel} の直しを1つ前に戻しました。`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "元に戻せませんでした");
    }
  }

  async function toggleAck(issue: ReviewedIssue, acknowledged: boolean) {
    const url = "/api/vehicle-pl/issue-ack";
    const res = acknowledged
      ? await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            yearMonth,
            vehicleNo: issue.vehicleNo,
            field: issue.field,
            code: issue.code,
          }),
        })
      : await fetch(
          `${url}?yearMonth=${encodeURIComponent(yearMonth)}&vehicleNo=${encodeURIComponent(issue.vehicleNo)}&field=${encodeURIComponent(issue.field)}&code=${encodeURIComponent(issue.code)}`,
          { method: "DELETE" },
        );
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      ackedByName?: string | null;
    } | null;
    if (!res.ok) {
      setNotice(data?.error ?? "確認済みにできませんでした");
      return;
    }
    setAcks((prev) => ({
      ...prev,
      [issue.key]: { acknowledged, ackedByName: data?.ackedByName ?? null },
    }));
  }

  async function applyPending() {
    setApplying(true);
    setNotice(null);
    try {
      const res = await fetch("/api/vehicle-pl/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        appliedCount?: number;
        vehicleCount?: number;
      } | null;
      if (!res.ok) {
        setNotice(data?.error ?? "収支表に反映できませんでした");
        return;
      }
      setNotice(
        `直し${data?.appliedCount ?? 0}件を反映して、${data?.vehicleCount ?? 0}台分の収支表を作り直しました。`,
      );
      router.refresh();
    } catch {
      setNotice("通信エラーが発生しました");
    } finally {
      setApplying(false);
    }
  }

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

      <ReviewProgressBar
        progress={progress}
        vehicleCount={rows.length}
        pendingCount={pendingCount}
        canEdit={canEdit}
        applying={applying}
        onApply={() => void applyPending()}
      />

      {lockedReason ? (
        <p className="mb-3 rounded-lg border border-line bg-subtle px-4 py-2 text-xs text-ink">
          {lockedReason}
        </p>
      ) : (
        <p className="mb-3 text-xs text-ink-muted">
          色の付いたセルをダブルクリック(またはEnter・F2)すると、その場で数字を直せます。
          直した値はすぐ保存され、収支表への反映はまとめて1回だけ行います。
        </p>
      )}

      {notice ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-brand-soft bg-brand-mist px-4 py-2 text-xs text-brand-deep">
          <p>{notice}</p>
          {undo && canEdit ? (
            <button
              type="button"
              onClick={() => void undoLastEdit()}
              className="pressable rounded border border-brand px-3 py-0.5 font-semibold"
            >
              元に戻す
            </button>
          ) : null}
        </div>
      ) : null}

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
                  {isEditableField(col) && canEdit ? (
                    <span className="ml-1 text-[10px] font-normal text-brand-deep">直せます</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, rowIndex) => {
              const cellIssues = issuesByCell(row);
              const profit = Number(row.values.profit ?? 0);
              const rowSeverity = heaviestSeverity(openIssuesOf(row));
              return (
                <tr key={row.vehicleNo} className="border-b border-line last:border-b-0 hover:bg-subtle">
                  {columns.map((col, colIndex) => {
                    const value = valueOf(row, col);
                    const issues = cellIssues.get(col) ?? [];
                    const openCellIssues = issues.filter((i) => !i.acknowledged);
                    const severity = heaviestSeverity(openCellIssues);
                    const allAcked = issues.length > 0 && openCellIssues.length === 0;
                    const isOpen = opened?.vehicleNo === row.vehicleNo && opened.field === col;
                    const editable = canEdit && isEditableField(col);
                    const isEditing =
                      editing?.vehicleNo === row.vehicleNo && editing.field === col;
                    const pending = isPendingCell(row, col);

                    if (col === "no") {
                      return (
                        <td
                          key={col}
                          className={`sticky left-0 z-10 whitespace-nowrap px-3 py-2 ${rowSeverity === "blocking" ? "bg-danger-soft" : "bg-white"}`}
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

                    const interactive = editable || issues.length > 0;
                    const content = formatCell(col, value);

                    return (
                      <td
                        key={col}
                        id={interactive ? `gridcell-${rowIndex}-${colIndex}` : undefined}
                        tabIndex={interactive ? 0 : undefined}
                        onDoubleClick={editable ? () => startEdit(row, col) : undefined}
                        onClick={
                          issues.length > 0
                            ? () =>
                                setOpened(
                                  isOpen ? null : { vehicleNo: row.vehicleNo, field: col },
                                )
                            : undefined
                        }
                        onKeyDown={(e) => {
                          if (!interactive) return;
                          if (e.key === "Enter" || e.key === "F2") {
                            e.preventDefault();
                            if (editable) startEdit(row, col);
                            else setOpened({ vehicleNo: row.vehicleNo, field: col });
                            return;
                          }
                          const moves: Record<string, [number, number]> = {
                            ArrowUp: [-1, 0],
                            ArrowDown: [1, 0],
                            ArrowLeft: [0, -1],
                            ArrowRight: [0, 1],
                          };
                          const move = moves[e.key];
                          if (move) {
                            e.preventDefault();
                            moveFocus(rowIndex, colIndex, move[0], move[1]);
                          }
                        }}
                        aria-label={
                          interactive
                            ? `${row.vehicleNoLabel} ${labelOf(col)} ${content}${editable ? " 編集できます" : ""}`
                            : undefined
                        }
                        className={[
                          "whitespace-nowrap px-3 py-2",
                          isTextColumn(col) ? "text-left" : "num text-right",
                          col === "profit" && profit < 0 ? "font-bold text-danger" : "",
                          allAcked ? ACKED_CELL : severity ? SEVERITY_STYLE[severity].cell : "",
                          pending ? "border border-dashed border-accent bg-accent-mist" : "",
                          isOpen || isEditing ? "outline outline-2 outline-brand" : "",
                          editable ? "cursor-cell" : "",
                        ].join(" ")}
                      >
                        <span className={issues.length > 0 ? "underline decoration-dotted underline-offset-2" : ""}>
                          {content}
                        </span>
                        {pending ? (
                          <span className="ml-1 text-[10px] font-semibold text-accent-deep">
                            反映待ち
                          </span>
                        ) : null}
                        {allAcked ? (
                          <span className="ml-1 text-[10px] font-semibold text-ink-muted">✓</span>
                        ) : null}
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

      {pendingCount > 0 ? (
        <p className="mt-2 text-xs text-ink-muted">
          合計行と、損益・経費計などの計算結果は、反映するまで直す前の数字のままです。
        </p>
      ) : null}

      {editing
        ? (() => {
            const row = rows.find((r) => r.vehicleNo === editing.vehicleNo);
            if (!row) return null;
            const currentValue = valueOf(row, editing.field);
            return (
              <CellEditor
                key={`${editing.vehicleNo}-${editing.field}`}
                vehicleNoLabel={row.vehicleNoLabel}
                field={editing.field}
                currentValue={typeof currentValue === "number" ? currentValue : null}
                defaultReason={reasonOf(row)}
                onCancel={() => setEditing(null)}
                onSave={(value, reason) => saveEdit(row, editing.field, value, reason)}
              />
            );
          })()
        : openedRow && openedIssues.length > 0 ? (
            <IssuePanel
              vehicleNo={openedRow.vehicleNoLabel}
              field={opened!.field}
              issues={openedIssues}
              canEdit={canEdit}
              editable={canEdit && isEditableField(opened!.field as ColumnKey)}
              onEdit={() => startEdit(openedRow, opened!.field as EditableColumn)}
              onToggleAck={(issue, acknowledged) => void toggleAck(issue, acknowledged)}
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
 * 「今月あと何件見ればよいか」と「反映待ちが何件あるか」を先に示す。
 *
 * 表を上から全部見る運用に戻さないための入口で、ここが空なら確認作業は終わっている。
 * 反映を溜める設計にしている以上、溜まっていること自体が見えていないと反映漏れになるため、
 * 確認の進み具合と反映待ちの件数は必ず同じ場所に置く。
 */
function ReviewProgressBar({
  progress,
  vehicleCount,
  pendingCount,
  canEdit,
  applying,
  onApply,
}: {
  progress: { blocking: number; warning: number; info: number; acknowledged: number; cleanVehicles: number };
  vehicleCount: number;
  pendingCount: number;
  canEdit: boolean;
  applying: boolean;
  onApply: () => void;
}) {
  const remaining = progress.blocking + progress.warning;
  const done = progress.acknowledged;
  return (
    <div className="mb-3 rounded-lg border border-line bg-white px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {remaining === 0 ? (
          <p className="text-sm font-semibold text-ink">
            {pendingCount > 0
              ? "確認は終わりました。「収支表に反映する」を押すと、直した数字が表に入ります。"
              : `確認が必要な箇所はありません。${vehicleCount}台すべてこのまま確定できます。`}
          </p>
        ) : (
          <>
            <p className="text-sm text-ink">
              あと<span className="font-semibold">{remaining}件</span>確認してください。
              {done > 0 ? `(確認済み ${done}件)` : null}
              残り{progress.cleanVehicles}台は指摘なしです。
            </p>
            {(["blocking", "warning", "info"] as const).map((severity) => {
              const count = progress[severity];
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

        {canEdit ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-ink-muted">
              {pendingCount > 0 ? `反映待ちの直し ${pendingCount}件` : "反映待ちはありません"}
            </span>
            <button
              type="button"
              disabled={applying || pendingCount === 0}
              onClick={onApply}
              className="pressable rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
            >
              {applying ? "反映しています…" : "収支表に反映する"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * セル1つを直す欄。
 *
 * 表の中で直接入力させると、横スクロールする表の中に入力欄が埋もれて理由を書く場所が作れない。
 * 既存の所見と同じく表の下に開き、「いまの値」「直す値」「理由」を1画面に並べる。
 * 理由を必須にしているのは、翌月に同じ手直しをするか後から誰かが判断できるようにするため。
 */
function CellEditor({
  vehicleNoLabel,
  field,
  currentValue,
  defaultReason,
  onCancel,
  onSave,
}: {
  vehicleNoLabel: string;
  field: OverridableField;
  currentValue: number | null;
  defaultReason: string;
  onCancel: () => void;
  onSave: (value: number, reason: string) => Promise<void>;
}) {
  const meta = OVERRIDABLE_FIELD_META[field];
  const allowsDecimal = DECIMAL_FIELDS.has(field);
  const [value, setValue] = useState(currentValue === null ? "" : String(currentValue));
  const [reason, setReason] = useState(defaultReason);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const valueRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    valueRef.current?.focus();
    valueRef.current?.select();
  }, []);

  function validate(): number | null {
    const trimmed = value.trim();
    if (trimmed === "") {
      setError("直す値を入力してください");
      return null;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      setError("数字を入力してください");
      return null;
    }
    if (n < 0) {
      setError(`${meta.label}に負の値は入れられません`);
      return null;
    }
    if (!allowsDecimal && !Number.isInteger(n)) {
      setError(`${meta.label}は整数で入力してください`);
      return null;
    }
    return n;
  }

  async function submit() {
    const n = validate();
    if (n === null) return;
    if (reason.trim() === "") {
      setError("直した理由を入力してください(翌月に同じ判断を引き継ぐために使います)");
      reasonRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(n, reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-brand bg-white p-4" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-sm font-bold text-ink">
          車番 {vehicleNoLabel} ／ {meta.label} を直す
        </h3>
        <span className="text-[11px] text-ink-muted">
          出どころ: {meta.source} / Enterで保存、Escで取消
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded border border-line px-2 py-0.5 text-xs text-ink-muted hover:bg-subtle"
        >
          閉じる
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <div>
          <span className="block text-[11px] text-ink-muted">いまの値</span>
          <span className="num text-sm text-ink">
            {currentValue === null ? "—" : currentValue.toLocaleString("ja-JP")} {meta.unit}
          </span>
        </div>
        <label className="text-xs text-ink">
          <span className="block font-semibold">直す値</span>
          <input
            ref={valueRef}
            type="number"
            inputMode="decimal"
            step={allowsDecimal ? "0.1" : "1"}
            min={0}
            disabled={saving}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="num mt-1 w-40 rounded-md border border-line px-2 py-1.5 text-right text-sm"
          />
          <span className="ml-1 text-[11px] text-ink-muted">{meta.unit}</span>
        </label>
        <label className="min-w-64 flex-1 text-xs text-ink">
          <span className="block font-semibold">直した理由(必須)</span>
          <input
            ref={reasonRef}
            type="text"
            disabled={saving}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例: 請求側で15万円減額したため"
            className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={() => void submit()}
          className="pressable rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
        >
          {saving ? "保存しています…" : "保存する"}
        </button>
      </div>

      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      <p className="mt-2 text-[11px] text-ink-muted">
        保存した値はこの画面を閉じても消えません。損益や経費計は「収支表に反映する」を押したときに作り直されます。
      </p>
    </div>
  );
}

/**
 * 指摘の中身。「印が付いている」だけでは人はOK/NGを決められないので、
 * 何と比べてそう判断したのかを値で並べ、直しに行く先も一緒に置く。
 * 直さずに通す判断もここで下せるようにする(判断材料と操作を離さない)。
 */
function IssuePanel({
  vehicleNo,
  field,
  issues,
  canEdit,
  editable,
  onEdit,
  onToggleAck,
  onClose,
}: {
  vehicleNo: string;
  field: string;
  issues: ReviewedIssue[];
  canEdit: boolean;
  editable: boolean;
  onEdit: () => void;
  onToggleAck: (issue: ReviewedIssue, acknowledged: boolean) => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-start gap-3">
        <h3 className="text-sm font-bold text-ink">
          車番 {vehicleNo} ／ {FIELD_LABELS[field as VehiclePlField] ?? field}
        </h3>
        {editable ? (
          <button
            type="button"
            onClick={onEdit}
            className="pressable rounded border border-brand px-3 py-0.5 text-xs font-semibold text-brand-deep"
          >
            この値を直す
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded border border-line px-2 py-0.5 text-xs text-ink-muted hover:bg-subtle"
        >
          閉じる
        </button>
      </div>

      <ul className="mt-3 space-y-3">
        {issues.map((issue) => (
          <li key={issue.key} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                  issue.acknowledged
                    ? "border-line bg-subtle text-ink-muted"
                    : SEVERITY_STYLE[issue.severity].chip
                }`}
              >
                {issue.acknowledged ? "確認済み" : SEVERITY_STYLE[issue.severity].label}
              </span>
              <span className="text-sm font-semibold text-ink">{issue.title}</span>

              {canEdit ? (
                <button
                  type="button"
                  onClick={() => onToggleAck(issue, !issue.acknowledged)}
                  className={`pressable ml-auto rounded px-3 py-1 text-xs font-semibold ${
                    issue.acknowledged
                      ? "border border-line text-ink-muted hover:bg-subtle"
                      : "border border-brand text-brand-deep"
                  }`}
                >
                  {issue.acknowledged ? "確認済みを取り消す" : "確認しました(このままでよい)"}
                </button>
              ) : null}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{issue.reason}</p>

            {issue.acknowledged && issue.ack?.ackedByName ? (
              <p className="mt-1 text-[11px] text-ink-muted">
                確認した人: {issue.ack.ackedByName}
              </p>
            ) : null}

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
