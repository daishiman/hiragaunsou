"use client";

import Link from "next/link";
import { useState } from "react";
import { NumberEntryField } from "../../_components/NumberEntryField";
import type { OverridableField } from "../../../src/domain/rules/vehiclePlOverride";

/**
 * 手入力 STEP4「人件費の確認」。
 *
 * 業務フロー docx の STEP4 は「給与集計表CSVをシートに貼る」だけで、金額を手で書き換える手順が無い。
 * したがってこの画面の既定は取込値であり、金額の欄は取込値で埋まっている。
 *
 * ただし現行Excelでは、月中の車両の乗り換え等でどうしても合わない月に人が直接書き換えていた
 * (domain/rules/vehiclePlOverride.ts の実データ観察を参照)。直す手段を用意しないと、この画面は
 * 「見るだけ」で終わり、結局Excelで直すことになる。そこで取込値はそのまま残したまま、
 * 直した値を別の層(vehicle_pl_override)に重ねる形で編集できるようにする。
 *
 * この形にしたのは次の3つを同時に満たす必要があるため:
 *  - 取込値と手修正値が区別できる (どちらの数字を見ているのか画面から分かる)
 *  - CSVを取り込み直しても手修正が消えない (上書きは別テーブルで、再計算のたびに読み直される)
 *  - 誰がいつなぜ直したかが残り、元に戻せる (理由必須・監査ログ・取込値に戻すボタン)
 */

export interface PayrollDetailRow {
  vehicleNo: string;
  vehicleType: string;
  depot: string;
  driverName: string | null;
  driverCount: number;
  /** 給与集計表CSVから集計した値。手修正しても変わらない。 */
  importedSalary: number;
  importedWelfare: number;
  /** 収支表に載る値。手修正があればその値。 */
  salary: number;
  welfare: number;
  salaryOverridden: boolean;
  welfareOverridden: boolean;
  /** その車両の直し全体。給与だけ直すときも他の直し(走行距離など)を消さないよう持ち回す。 */
  overrideValues: Partial<Record<OverridableField, number>>;
  overrideExcluded: boolean;
  overrideReason: string | null;
  overrideUpdatedAt: number | null;
  payrollMatchedCount: number;
}

export interface PayrollDetailSummary {
  payrollRowCount: number;
  driverMasterCount: number;
  assignedVehicleCount: number;
  payrollMissingVehicleCount: number;
}

export type PayrollStatus = {
  fileName: string;
  rowCount: number;
  importedAt: number;
} | null;

/**
 * 「663,820」「６６３８２０」いずれの書き方でも金額として受ける。
 * 給与は請求書のような足し算の合算が要らない(1人1金額)ので、足し算式は受けない。
 * 読めない文字が混ざっていたら null を返し、保存させない。
 */
export function parseYen(raw: string): number | null {
  const normalized = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/．/g, ".")
    .replace(/[,\s、]/g, "");
  if (normalized === "") return null;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** 編集中の行の生の入力値。保存するまでサーバへは送らない。 */
interface RowEdit {
  salary: string;
  welfare: string;
  reason: string;
}

function initialEdit(row: PayrollDetailRow): RowEdit {
  return {
    salary: String(row.salary),
    welfare: String(row.welfare),
    reason: row.overrideReason ?? "",
  };
}

export function PayrollStep({
  yearMonth,
  payrollStatus,
  rows: initialRows,
  summary,
  canManageMasters = false,
}: {
  yearMonth: string;
  payrollStatus: PayrollStatus;
  rows: readonly PayrollDetailRow[];
  summary: PayrollDetailSummary;
  /** 運転者マスタ・取込画面へ行ける権限があるか。無い人にリンクだけ出すと行き止まりになる。 */
  canManageMasters?: boolean;
}) {
  const [rows, setRows] = useState<readonly PayrollDetailRow[]>(initialRows);
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [savingVehicleNo, setSavingVehicleNo] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [search, setSearch] = useState("");

  const overriddenCount = rows.filter((r) => r.salaryOverridden || r.welfareOverridden).length;

  const query = search.trim().normalize("NFKC").toLowerCase();
  const filtered = query
    ? rows.filter(
        (r) =>
          r.vehicleNo.normalize("NFKC").toLowerCase().includes(query) ||
          (r.driverName ?? "").normalize("NFKC").toLowerCase().includes(query),
      )
    : rows;

  function editOf(row: PayrollDetailRow): RowEdit {
    return edits[row.vehicleNo] ?? initialEdit(row);
  }

  /** 入力欄の値が、いま収支表に載っている値と違うか(= 保存するものがあるか) */
  function isDirty(row: PayrollDetailRow): boolean {
    if (!(row.vehicleNo in edits)) return false;
    const edit = editOf(row);
    return parseYen(edit.salary) !== row.salary || parseYen(edit.welfare) !== row.welfare;
  }

  function setEdit(row: PayrollDetailRow, patch: Partial<RowEdit>) {
    setEdits((prev) => ({
      ...prev,
      [row.vehicleNo]: { ...(prev[row.vehicleNo] ?? initialEdit(row)), ...patch },
    }));
    setNotice("");
    setErrorMessage("");
  }

  function cancelEdit(row: PayrollDetailRow) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[row.vehicleNo];
      return next;
    });
    setErrorMessage("");
  }

  /**
   * その車両の直しを保存する。
   *
   * 取込値と同じ値に戻された項目は直しから外す。「取込値と同じ手修正」を残すと、
   * CSVを取り込み直したあとも古い取込値に固定され続け、本人には理由が分からない。
   */
  async function saveRow(row: PayrollDetailRow) {
    const edit = editOf(row);
    const salary = parseYen(edit.salary);
    const welfare = parseYen(edit.welfare);
    if (salary === null || welfare === null) {
      setErrorMessage("金額は数字で入力してください");
      return;
    }
    if (salary < 0 || welfare < 0) {
      setErrorMessage("金額に負の値は入れられません");
      return;
    }
    const reason = edit.reason.trim();
    if (reason === "") {
      setErrorMessage("直した理由を書いてください(後から誰が見ても判断を追えるようにするため)");
      return;
    }

    const values: Record<string, number> = { ...row.overrideValues };
    if (salary === row.importedSalary) delete values.salary;
    else values.salary = salary;
    if (welfare === row.importedWelfare) delete values.welfare;
    else values.welfare = welfare;

    setSavingVehicleNo(row.vehicleNo);
    setErrorMessage("");
    try {
      // 直しが1つも残らないなら、上書きのレコードごと消す(空の直しは保存できない)。
      const isEmpty = Object.keys(values).length === 0 && !row.overrideExcluded;
      const res = isEmpty
        ? await fetch(
            `/api/vehicle-pl/override?yearMonth=${encodeURIComponent(yearMonth)}&vehicleNo=${encodeURIComponent(row.vehicleNo)}`,
            { method: "DELETE" },
          )
        : await fetch("/api/vehicle-pl/override", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              yearMonth,
              vehicleNo: row.vehicleNo,
              excluded: row.overrideExcluded,
              values,
              reason,
              // 収支表への反映は最後のステップの「収支表を作り直す」でまとめて行う。
              // 1台直すたびに月まるごと計算し直すと、何十台も直す月は待ち時間が積み上がる。
              deferRecalculation: true,
              expectedUpdatedAt: row.overrideUpdatedAt,
            }),
          });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        conflict?: boolean;
        updatedAt?: number | null;
      } | null;
      if (!res.ok) {
        setErrorMessage(
          data?.conflict
            ? "この車両は先に別の人が直しています。画面を開き直してから、もう一度直してください。"
            : (data?.error ?? "保存できませんでした"),
        );
        return;
      }

      setRows((prev) =>
        prev.map((r) =>
          r.vehicleNo === row.vehicleNo
            ? {
                ...r,
                salary,
                welfare,
                salaryOverridden: values.salary !== undefined,
                welfareOverridden: values.welfare !== undefined,
                overrideValues: values as Partial<Record<OverridableField, number>>,
                overrideReason: isEmpty ? null : reason,
                overrideUpdatedAt: isEmpty ? null : (data?.updatedAt ?? null),
              }
            : r,
        ),
      );
      cancelEdit(row);
      setNotice(
        isEmpty
          ? `車番${row.vehicleNo} を取込値に戻しました。最後のステップで「収支表を作り直す」を押すと反映されます。`
          : `車番${row.vehicleNo} の人件費を保存しました。最後のステップで「収支表を作り直す」を押すと反映されます。`,
      );
    } catch {
      setErrorMessage("通信エラーが発生しました");
    } finally {
      setSavingVehicleNo(null);
    }
  }

  /** 手修正を捨てて、給与集計表CSVの値に戻す。 */
  function revertToImported(row: PayrollDetailRow) {
    setEdit(row, {
      salary: String(row.importedSalary),
      welfare: String(row.importedWelfare),
      reason: "取込値に戻す",
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-bold text-ink">人件費(給与集計表)の確認</h2>
        {/* 状態は文章ではなくバッジで。色だけに頼らず「取込済み / 未取込」の文字を必ず出す */}
        {payrollStatus ? (
          <>
            <p className="mt-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand-deep">
                <span aria-hidden>✓</span>取込済み
              </span>
            </p>
            <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-xs text-ink-muted">ファイル</dt>
              <dd className="truncate text-ink">{payrollStatus.fileName}</dd>
              <dt className="text-xs text-ink-muted">件数</dt>
              <dd className="num text-ink">{payrollStatus.rowCount}件</dd>
              <dt className="text-xs text-ink-muted">取込日時</dt>
              <dd className="num text-ink">
                {new Date(payrollStatus.importedAt).toLocaleString("ja-JP")}
              </dd>
            </dl>
          </>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-caution-border bg-caution-soft px-3 py-1 text-xs font-bold text-ink">
              <span aria-hidden>!</span>未取込
            </span>
            <Link
              href={`/import?step=4&ym=${yearMonth}`}
              className="pressable rounded-md border border-brand px-3 py-1.5 text-xs font-semibold text-brand-deep hover:bg-brand-soft"
            >
              データ取込へ
            </Link>
          </div>
        )}
      </div>

      {/*
        金額が0円で並んでいるとき、原因は「CSVが未取込」「運転者マスタが空」「社員Noが突合しない」の
        3つに分かれる。どれなのかを金額だけからは読めないので、数えて名指しする。
        これを出さないと、表は「全車0円」に見えたまま、直しようがない画面になる。
      */}
      <PayrollDiagnosis
        yearMonth={yearMonth}
        summary={summary}
        vehicleCount={rows.length}
        hasPayrollBatch={payrollStatus !== null}
        canManageMasters={canManageMasters}
      />

      {rows.length === 0 ? (
        <p className="text-xs text-ink-muted">
          車両マスタが登録されていないため、車両別の内訳を出せません。
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-ink">
              <span className="sr-only">車番・運転者で検索</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="車番・運転者で検索"
                className="w-56 rounded-md border border-line px-3 py-1.5"
              />
            </label>
            <p className="num text-xs text-ink-muted">
              表示 {filtered.length}台 / 全 {rows.length}台
              {overriddenCount > 0 ? ` ・ 手修正 ${overriddenCount}台` : ""}
            </p>
          </div>

          <div className="max-h-[56vh] min-h-[14rem] overflow-auto rounded-md border border-line">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-subtle">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-bold text-ink-muted">車番</th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-ink-muted">運転者</th>
                  <th className="px-3 py-2 text-right text-xs font-bold text-ink-muted whitespace-nowrap">
                    総支給額(円)
                    <span className="block text-[11px] font-normal">給与集計表CSV</span>
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-bold text-ink-muted whitespace-nowrap">
                    社保合計(円)
                    <span className="block text-[11px] font-normal">給与集計表CSV</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const edit = editOf(row);
                  const dirty = isDirty(row);
                  return (
                    <tr
                      key={row.vehicleNo}
                      // 保存していない行は、表の中でも見つけられるようにしておく
                      // (表の下の操作パネルと行が離れていても、どの行の話か迷わない)
                      className={`border-t border-line align-top ${dirty ? "bg-caution-soft" : ""}`}
                    >
                      <td className="num px-3 py-2 whitespace-nowrap">{row.vehicleNo}</td>
                      <td className="px-3 py-2">
                        {row.driverName ?? <span className="text-danger">未割当</span>}
                        {/*
                          運転者は割り当たっているのに給与が見つからない車両は、0円が正しいのか
                          突合が外れているのか金額からは分からない。行の上で名指しする。
                        */}
                        {row.driverCount > 0 && row.payrollMatchedCount < row.driverCount ? (
                          <span className="mt-0.5 block text-[11px] text-danger">
                            給与データなし({row.driverCount - row.payrollMatchedCount}人分)
                          </span>
                        ) : null}
                      </td>
                      <PayrollAmountCell
                        label={`${row.vehicleNo}番の総支給額(円)`}
                        value={edit.salary}
                        imported={row.importedSalary}
                        overridden={row.salaryOverridden}
                        onChange={(v) => setEdit(row, { salary: v })}
                      />
                      <PayrollAmountCell
                        label={`${row.vehicleNo}番の社保合計(円)`}
                        value={edit.welfare}
                        imported={row.importedWelfare}
                        overridden={row.welfareOverridden}
                        onChange={(v) => setEdit(row, { welfare: v })}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/*
            直している行の操作(理由・保存・やめる)は表の外に出す。表のセル内に置くと
            列幅が理由の文字数で伸び縮みして、金額の桁が読み取りにくくなる。
          */}
          {filtered
            .filter((row) => isDirty(row) || (row.salaryOverridden || row.welfareOverridden))
            .map((row) => {
              const edit = editOf(row);
              const dirty = isDirty(row);
              return (
                <div
                  key={row.vehicleNo}
                  className={`rounded-md border px-4 py-3 ${
                    dirty ? "border-caution-border bg-caution-soft" : "border-line bg-subtle"
                  }`}
                >
                  <p className="text-xs font-bold text-ink">
                    車番 <span className="num">{row.vehicleNo}</span>
                    {dirty ? " — 保存していない直しがあります" : " — 手修正されています"}
                  </p>
                  {!dirty && row.overrideReason ? (
                    <p className="mt-1 text-[11px] text-ink-muted">理由: {row.overrideReason}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    {dirty ? (
                      <label className="flex flex-1 flex-col gap-1 text-[11px] text-ink">
                        直した理由(必須)
                        <input
                          type="text"
                          value={edit.reason}
                          onChange={(e) => setEdit(row, { reason: e.target.value })}
                          placeholder="例: 月中に車両を乗り換えたため按分した"
                          className="min-w-[16rem] rounded-md border border-line bg-white px-3 py-1.5 text-xs"
                        />
                      </label>
                    ) : null}
                    {dirty ? (
                      <>
                        <button
                          type="button"
                          disabled={savingVehicleNo === row.vehicleNo}
                          onClick={() => void saveRow(row)}
                          className="pressable rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
                        >
                          {savingVehicleNo === row.vehicleNo ? "保存しています…" : "この車両を保存"}
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelEdit(row)}
                          className="pressable rounded-md border border-line bg-white px-4 py-1.5 text-xs text-ink hover:bg-subtle"
                        >
                          やめる
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => revertToImported(row)}
                        className="pressable rounded-md border border-brand bg-white px-4 py-1.5 text-xs font-semibold text-brand-deep hover:bg-brand-soft"
                      >
                        取込値に戻す
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

          {errorMessage ? (
            <p className="rounded-md border border-danger px-4 py-2 text-xs text-danger">
              {errorMessage}
            </p>
          ) : null}
          {notice ? (
            <p className="rounded-md border border-brand bg-brand-soft px-4 py-2 text-xs text-ink">
              {notice}
            </p>
          ) : null}

          <p className="text-[11px] leading-relaxed text-ink-muted">
            この欄の既定は給与集計表CSVの金額です。直した金額は「手修正」として別に記録するため、
            給与集計表を取り込み直しても消えません。「取込値に戻す」でいつでも元の金額に戻せます。
            直した内容は、最後のステップで「収支表を作り直す」を押したときに収支表へ反映されます。
          </p>
        </>
      )}
    </div>
  );
}

/**
 * 金額1つ分のセル。全画面共通の入力欄 (NumberEntryField) を使う。
 *
 * この欄の「自動の値」は給与集計表CSVの取込値にあたる。取込値のままなら薄い文字に
 * 「取込値」の印、手で直せば通常の濃い文字に「取込値に戻す」が出る — 高速料金やタイヤ代と
 * 全く同じ作法にすることで、タブが変わるたびに欄の読み方を考え直さずに済む。
 *
 * 共通部品は「人が触っていない = 空文字」で持つのに対し、人件費は常に実額を保存するため、
 * ここで値を橋渡しする (取込値と同じなら空文字として渡し、空で戻ってきたら取込値に復元)。
 */
function PayrollAmountCell({
  label,
  value,
  imported,
  overridden,
  onChange,
}: {
  label: string;
  value: string;
  imported: number;
  overridden: boolean;
  onChange: (value: string) => void;
}) {
  const importedRaw = String(imported);
  return (
    <td className="px-3 py-2 text-right">
      <NumberEntryField
        value={value === importedRaw ? "" : value}
        onChange={(raw) => onChange(raw === "" ? importedRaw : raw)}
        autoValue={imported}
        autoLabel="取込値"
        ariaLabel={label}
        parse={parseYen}
        invalidMessage="数字で入力してください"
        // 戻す入口は行ごとの「取込値に戻す」(保存済みの直しごと取り消す) に一本化する
        resettable={false}
        hints={
          // 保存済みの手修正は、開き直したときにも「直っている」と分かるようにする
          overridden ? <p className="text-[11px] font-semibold text-ink">手修正</p> : null
        }
      />
    </td>
  );
}

/**
 * 0円が並ぶ理由を名指しする。
 * 上から順に「これを直せば先へ進める」ものだけを1つ出す(3つ並べると、どれから手を付けるか
 * の判断がもう1つ増える)。
 */
function PayrollDiagnosis({
  yearMonth,
  summary,
  vehicleCount,
  hasPayrollBatch,
  canManageMasters,
}: {
  yearMonth: string;
  summary: PayrollDetailSummary;
  vehicleCount: number;
  hasPayrollBatch: boolean;
  canManageMasters: boolean;
}) {
  if (vehicleCount === 0) return null;

  const problem = !hasPayrollBatch
    ? {
        title: "給与集計表がまだ取り込まれていないため、全車0円で表示されています",
        body: "ACELINK NX-CE から出力した『給与集計表(日給者)』を取り込むと、この表に金額が入ります。",
        href: `/import?step=4&ym=${yearMonth}`,
        linkLabel: "データ取込へ",
        needsAdmin: false,
      }
    : summary.driverMasterCount === 0 || summary.assignedVehicleCount === 0
      ? {
          title: "運転者マスタが未登録のため、全車0円・未割当で表示されています",
          body: `給与集計表は${summary.payrollRowCount}件取り込めていますが、社員Noと車番の対応表(運転者マスタ)が無いため、どの車両の給与なのか結び付けられません。運転者マスタを登録すると、この表に金額が入ります。`,
          href: "/admin/driver-master",
          linkLabel: "運転者マスタの登録へ",
          needsAdmin: true,
        }
      : summary.payrollMissingVehicleCount > 0
        ? {
            title: `給与集計表に社員Noが見つからない運転者がいます(${summary.payrollMissingVehicleCount}台)`,
            body: "運転者マスタには登録されていますが、今月の給与集計表にその社員Noの明細がありません。その車両の給与は0円のまま集計されます。運転者マスタの社員No、または取り込んだCSVの対象月を確認してください。",
            href: "/admin/driver-master",
            linkLabel: "運転者マスタを確認",
            needsAdmin: true,
          }
        : null;

  if (!problem) return null;

  return (
    <div className="rounded-md border border-caution-border bg-caution-soft px-4 py-3">
      <p className="text-sm font-bold text-ink">{problem.title}</p>
      <p className="num mt-1 text-xs leading-relaxed text-ink">{problem.body}</p>
      {!problem.needsAdmin || canManageMasters ? (
        <Link
          href={problem.href}
          className="pressable mt-3 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep"
        >
          {problem.linkLabel}
        </Link>
      ) : (
        <p className="mt-2 text-xs font-semibold text-ink">
          管理者に運転者マスタの登録を依頼してください。
        </p>
      )}
    </div>
  );
}
