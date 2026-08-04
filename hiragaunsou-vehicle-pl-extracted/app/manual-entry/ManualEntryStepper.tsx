"use client";

import { useRef, useState } from "react";

export interface VehicleRow {
  vehicleNo: string;
  driver: string | null;
}

export interface PrefillValues {
  repairActual: Record<string, number>;
  fuelOut: Record<string, number>;
  fuelOutQty: Record<string, number>;
  fuelInQty: Record<string, number>;
  adblue: Record<string, number>;
  equip: Record<string, number>;
  mainte: Record<string, number>;
  miscOther: Record<string, number>;
  tankPricePerLiter: number;
}

export type PayrollStatus = {
  fileName: string;
  rowCount: number;
  importedAt: number;
} | null;

type NumericField =
  | "repairActual"
  | "fuelOut"
  | "fuelOutQty"
  | "fuelInQty"
  | "adblue"
  | "equip"
  | "mainte"
  | "miscOther";

type Values = Record<NumericField, Record<string, number>>;

/** IME確定中のEnterでは送らず、通常のEnterは次フィールドへ移動する(誤送信防止・design-system規律)。 */
function handleEnterMovesNext(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter") return;
  if (e.nativeEvent.isComposing) return;
  e.preventDefault();
  const form = e.currentTarget.form;
  if (!form) return;
  const inputs = Array.from(form.querySelectorAll<HTMLInputElement>("input[data-step-field]"));
  const idx = inputs.indexOf(e.currentTarget);
  const next = inputs[idx + 1];
  if (next) next.focus();
}

const STEP_TITLES = [
  "対象年月",
  "修理費実費",
  "インタンク単価",
  "外部給油明細",
  "給与取込確認",
  "例外上書き(任意)",
  "確認して送信",
] as const;

export function ManualEntryStepper({
  yearMonth,
  vehicles,
  prefill,
  payrollStatus,
}: {
  yearMonth: string;
  vehicles: VehicleRow[];
  prefill: PrefillValues;
  payrollStatus: PayrollStatus;
}) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values>({
    repairActual: prefill.repairActual,
    fuelOut: prefill.fuelOut,
    fuelOutQty: prefill.fuelOutQty,
    fuelInQty: prefill.fuelInQty,
    adblue: prefill.adblue,
    equip: prefill.equip,
    mainte: prefill.mainte,
    miscOther: prefill.miscOther,
  });
  const [tankPrice, setTankPrice] = useState(prefill.tankPricePerLiter);
  const [payrollConfirmed, setPayrollConfirmed] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  function setValue(field: NumericField, vehicleNo: string, raw: string) {
    setValues((prev) => ({ ...prev, [field]: { ...prev[field], [vehicleNo]: Number(raw) || 0 } }));
  }

  async function submit() {
    setSubmitState("pending");
    setErrorMessage("");
    const manualInputs = vehicles.map((v) => ({
      vehicleNo: v.vehicleNo,
      repairActual: values.repairActual[v.vehicleNo] ?? 0,
      fuelOut: values.fuelOut[v.vehicleNo] ?? 0,
      fuelOutQty: values.fuelOutQty[v.vehicleNo] ?? 0,
      fuelInQty: values.fuelInQty[v.vehicleNo] ?? 0,
      adblue: values.adblue[v.vehicleNo] ?? 0,
      equip: values.equip[v.vehicleNo] ?? 0,
      mainte: values.mainte[v.vehicleNo] ?? 0,
      miscOther: values.miscOther[v.vehicleNo] ?? 0,
    }));

    try {
      const res = await fetch("/api/manual-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ yearMonth, tankPricePerLiter: tankPrice, manualInputs }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMessage(data.error ?? "送信に失敗しました");
        setSubmitState("error");
        return;
      }
      setSubmitState("done");
    } catch {
      setErrorMessage("通信エラーが発生しました");
      setSubmitState("error");
    }
  }

  function renderVehicleTable(field: NumericField, label: string, unit: string) {
    return (
      <div className="max-h-[50vh] overflow-y-auto rounded-md border border-line">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-subtle">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-bold text-ink-muted">車番</th>
              <th className="px-3 py-2 text-left text-xs font-bold text-ink-muted">運転者</th>
              <th className="px-3 py-2 text-right text-xs font-bold text-ink-muted">
                {label}({unit})
              </th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.vehicleNo} className="border-t border-line">
                <td className="px-3 py-2 num">{v.vehicleNo}</td>
                <td className="px-3 py-2">{v.driver ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    data-step-field
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={values[field][v.vehicleNo] ?? 0}
                    onChange={(e) => setValue(field, v.vehicleNo, e.target.value)}
                    onKeyDown={handleEnterMovesNext}
                    className="num w-32 rounded-md border border-line px-2 py-1 text-right"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const isLast = step === STEP_TITLES.length - 1;

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        if (isLast) void submit();
      }}
      className="flex flex-col gap-6"
    >
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <span className="num">
          {step + 1} / {STEP_TITLES.length}
        </span>
        <span>{STEP_TITLES[step]}</span>
      </div>

      <section className="rise-in rounded-xl border border-line bg-white p-5">
        {step === 0 ? (
          <div>
            <h2 className="text-sm font-bold text-ink">対象年月</h2>
            <p className="mt-2 num text-2xl font-bold text-ink">{yearMonth}</p>
            <p className="mt-2 text-xs text-ink-muted">この月の手入力(層③)を進めます。</p>
          </div>
        ) : null}

        {step === 1 ? (
          <div>
            <h2 className="text-sm font-bold text-ink">修理費実費</h2>
            <p className="mt-1 text-xs text-ink-muted">
              修理伝票/請求書の実費を入力してください(推計原価とは別に保持されます)。
            </p>
            <div className="mt-4">{renderVehicleTable("repairActual", "修理費実費", "円")}</div>
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <h2 className="text-sm font-bold text-ink">インタンク単価</h2>
            <p className="mt-1 text-xs text-ink-muted">
              今月の仕入単価(円/ℓ)。全車のインタンク軽油代へ一括反映されます。
            </p>
            <input
              data-step-field
              type="number"
              inputMode="decimal"
              min={0}
              value={tankPrice}
              onChange={(e) => setTankPrice(Number(e.target.value) || 0)}
              onKeyDown={handleEnterMovesNext}
              className="num mt-4 w-40 rounded-md border border-line px-3 py-2 text-right text-lg"
            />
            <span className="ml-2 text-sm text-ink-muted">円/ℓ</span>
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <h2 className="text-sm font-bold text-ink">外部給油明細</h2>
            <p className="mt-1 text-xs text-ink-muted">外部給油カード明細の金額と給油量を入力してください。</p>
            <div className="mt-4 flex flex-col gap-4">
              {renderVehicleTable("fuelOut", "外部給油代", "円")}
              {renderVehicleTable("fuelOutQty", "外部給油量", "ℓ")}
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div>
            <h2 className="text-sm font-bold text-ink">給与取込確認</h2>
            {payrollStatus ? (
              <div className="mt-3 grid grid-cols-[8rem_1fr] gap-2 text-sm">
                <dt className="text-xs text-ink-muted">取込ファイル</dt>
                <dd className="text-ink">{payrollStatus.fileName}</dd>
                <dt className="text-xs text-ink-muted">件数</dt>
                <dd className="num text-ink">{payrollStatus.rowCount}件</dd>
                <dt className="text-xs text-ink-muted">取込日時</dt>
                <dd className="text-ink">{new Date(payrollStatus.importedAt).toLocaleString("ja-JP")}</dd>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">
                この月の給与集計表はまだ取込まれていません。「データ取込」から先に取込んでください。
              </p>
            )}
            <label className="mt-4 flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={payrollConfirmed}
                onChange={(e) => setPayrollConfirmed(e.target.checked)}
              />
              内容を確認しました
            </label>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-sm font-bold text-ink">例外上書き(任意)</h2>
              <p className="mt-1 text-xs text-ink-muted">
                アドブルー・備品費・メンテ費・その他諸経費・インタンク給油量を必要な車両だけ上書きできます。
              </p>
            </div>
            {renderVehicleTable("adblue", "アドブルー", "円")}
            {renderVehicleTable("equip", "備品費", "円")}
            {renderVehicleTable("mainte", "メンテ費", "円")}
            {renderVehicleTable("miscOther", "その他諸経費", "円")}
            {renderVehicleTable("fuelInQty", "インタンク給油量", "ℓ")}
          </div>
        ) : null}

        {isLast ? (
          <div>
            <h2 className="text-sm font-bold text-ink">確認して送信</h2>
            <p className="mt-1 text-xs text-ink-muted">
              入力内容をもとに{yearMonth}の収支を再計算します。この操作は再実行(上書き)可能です。
            </p>
            {submitState === "error" ? (
              <div className="mt-3 rounded-md border border-caution-border bg-caution-soft px-4 py-3 text-xs">
                {errorMessage}
              </div>
            ) : null}
            {submitState === "done" ? (
              <div className="mt-3 rounded-md border border-line bg-subtle px-4 py-3 text-sm text-ink">
                収支を確定しました。グリッドに反映されています。
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="pressable rounded-md border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-subtle disabled:opacity-50"
        >
          戻る
        </button>
        {isLast ? (
          <button
            type="submit"
            disabled={submitState === "pending" || submitState === "done"}
            className="pressable rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
          >
            {submitState === "pending" ? "送信しています…" : "確定する"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEP_TITLES.length - 1, s + 1))}
            className="pressable rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep"
          >
            次へ
          </button>
        )}
      </div>
    </form>
  );
}
