"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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

/** 0を「入力済み」として扱ってよい項目(未入力でも0円で困らない) */
type NumericField =
  | "repairActual"
  | "fuelOut"
  | "fuelOutQty"
  | "fuelInQty"
  | "adblue"
  | "equip"
  | "mainte"
  | "miscOther";

/**
 * 「未入力」と「0円」を区別する項目。
 * 未入力のときだけ推計(タイヤ=km×単価、高速割引=組合割引率)にフォールバックするため、
 * 0で潰すと「請求書に載っていない車両」を0円で確定してしまう。
 */
type OptionalField = "tireActual" | "tollActual" | "tollDiscountActual";

type Values = Record<NumericField, Record<string, number>>;
type OptionalValues = Record<OptionalField, Record<string, string>>;

/**
 * 「1200+340+560」のような足し算式を受け付けて合計を返す。
 *
 * 業務フロー STEP6 の「請求書に割引額の合計が載っていないため個別の割引額を合算する」に対応する。
 * 電卓に持ち替えずその場で足せることが目的なので、全角数字・カンマ・空白も受ける(ポステルの法則)。
 * 数値として読めないときは null を返し、確定させない。
 */
export function parseSumExpression(raw: string): number | null {
  const normalized = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/＋/g, "+")
    .replace(/．/g, ".")
    .replace(/[,\s、]/g, "");
  if (normalized === "") return null;
  if (!/^[0-9.+]+$/.test(normalized)) return null;
  const parts = normalized.split("+").filter((p) => p !== "");
  if (parts.length === 0) return null;
  let sum = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n)) return null;
    sum += n;
  }
  return sum;
}

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

/** 「24,300」「24 300」「24、300」いずれの書き方でも車番の並びとして受ける */
function parseVehicleNoList(raw: string): string[] {
  return raw
    .split(/[,、\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * 画面のステップ = 業務フロー docx のステップ。
 * システム都合の並びにせず、手順書と同じ番号・同じ言葉で並べる(現在地を見失わせない)。
 */
const STEPS: readonly { workflowId: number | null; label: string }[] = [
  { workflowId: 2, label: "キリンの協力金" },
  { workflowId: 3, label: "燃料費" },
  { workflowId: 4, label: "人件費の確認" },
  { workflowId: 5, label: "修繕費・タイヤ" },
  { workflowId: 6, label: "高速料金" },
  { workflowId: null, label: "確認して確定" },
];

/** ?step=3 のような業務フロー番号を、画面のステップ位置に読み替える */
function initialIndexFromWorkflowStep(step: string | null | undefined): number {
  const id = Number(step);
  const idx = STEPS.findIndex((s) => s.workflowId === id);
  return idx >= 0 ? idx : 0;
}

export function ManualEntryStepper({
  yearMonth,
  vehicles,
  prefill,
  payrollStatus,
  initialWorkflowStep = null,
}: {
  yearMonth: string;
  vehicles: VehicleRow[];
  prefill: PrefillValues;
  payrollStatus: PayrollStatus;
  initialWorkflowStep?: string | null;
}) {
  const [step, setStep] = useState(() => initialIndexFromWorkflowStep(initialWorkflowStep));
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
  const [optional, setOptional] = useState<OptionalValues>({
    tireActual: {},
    tollActual: {},
    tollDiscountActual: {},
  });
  const [tankPrice, setTankPrice] = useState(prefill.tankPricePerLiter);
  const [kirinTransport, setKirinTransport] = useState("");
  const [kirinManagement, setKirinManagement] = useState("");
  // 配分先の車番は専属契約が変われば変わるので、コード定数ではなく設定として持つ
  const [kirinTargets, setKirinTargets] = useState("24,300");
  const [payrollConfirmed, setPayrollConfirmed] = useState(false);
  const [restored, setRestored] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [saveState, setSaveState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  // 保存済みの入力を読み戻す。請求書が届くたびに開き直して続きから入力できるようにするため。
  useEffect(() => {
    let aborted = false;
    void (async () => {
      try {
        const res = await fetch(`/api/manual-entry?yearMonth=${encodeURIComponent(yearMonth)}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          manualInputs?: {
            vehicleNo: string;
            fuelInQty: number;
            fuelOut: number;
            fuelOutQty: number;
            adblue: number;
            repairActual: number;
            tireActual: number | null;
            equip: number;
            mainte: number;
            tollActual: number | null;
            tollDiscountActual: number | null;
            miscOther: number;
          }[];
          kirinTargetVehicleNos?: string[];
        };
        if (aborted) return;
        if (data.kirinTargetVehicleNos && data.kirinTargetVehicleNos.length > 0) {
          setKirinTargets(data.kirinTargetVehicleNos.join(","));
        }
        const rows = data.manualInputs ?? [];
        if (rows.length === 0) return;

        setValues((prev) => {
          const next: Values = {
            repairActual: { ...prev.repairActual },
            fuelOut: { ...prev.fuelOut },
            fuelOutQty: { ...prev.fuelOutQty },
            fuelInQty: { ...prev.fuelInQty },
            adblue: { ...prev.adblue },
            equip: { ...prev.equip },
            mainte: { ...prev.mainte },
            miscOther: { ...prev.miscOther },
          };
          for (const r of rows) {
            next.repairActual[r.vehicleNo] = r.repairActual;
            next.fuelOut[r.vehicleNo] = r.fuelOut;
            next.fuelOutQty[r.vehicleNo] = r.fuelOutQty;
            next.fuelInQty[r.vehicleNo] = r.fuelInQty;
            next.adblue[r.vehicleNo] = r.adblue;
            next.equip[r.vehicleNo] = r.equip;
            next.mainte[r.vehicleNo] = r.mainte;
            next.miscOther[r.vehicleNo] = r.miscOther;
          }
          return next;
        });
        setOptional(() => {
          const next: OptionalValues = { tireActual: {}, tollActual: {}, tollDiscountActual: {} };
          for (const r of rows) {
            if (r.tireActual !== null) next.tireActual[r.vehicleNo] = String(r.tireActual);
            if (r.tollActual !== null) next.tollActual[r.vehicleNo] = String(r.tollActual);
            if (r.tollDiscountActual !== null) {
              next.tollDiscountActual[r.vehicleNo] = String(r.tollDiscountActual);
            }
          }
          return next;
        });
        setRestored(true);
      } catch {
        // 読み戻しに失敗しても入力自体は続けられるので、画面は止めない
      }
    })();
    return () => {
      aborted = true;
    };
  }, [yearMonth]);

  function setValue(field: NumericField, vehicleNo: string, raw: string) {
    setValues((prev) => ({ ...prev, [field]: { ...prev[field], [vehicleNo]: Number(raw) || 0 } }));
  }

  function setOptionalValue(field: OptionalField, vehicleNo: string, raw: string) {
    setOptional((prev) => ({ ...prev, [field]: { ...prev[field], [vehicleNo]: raw } }));
  }

  function buildPayload(saveOnly: boolean) {
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
      tireActual: parseSumExpression(optional.tireActual[v.vehicleNo] ?? ""),
      tollActual: parseSumExpression(optional.tollActual[v.vehicleNo] ?? ""),
      tollDiscountActual: parseSumExpression(optional.tollDiscountActual[v.vehicleNo] ?? ""),
    }));

    const transport = parseSumExpression(kirinTransport);
    const management = parseSumExpression(kirinManagement);

    return {
      yearMonth,
      tankPricePerLiter: tankPrice,
      manualInputs,
      kirin:
        transport !== null || management !== null
          ? {
              transportSupport: transport ?? 0,
              managementSupport: management ?? 0,
              targetVehicleNos: parseVehicleNoList(kirinTargets),
            }
          : undefined,
      saveOnly,
    };
  }

  async function post(saveOnly: boolean) {
    const setState = saveOnly ? setSaveState : setSubmitState;
    setState("pending");
    setErrorMessage("");
    try {
      const res = await fetch("/api/manual-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload(saveOnly)),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMessage(data.error ?? (saveOnly ? "保存に失敗しました" : "送信に失敗しました"));
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setErrorMessage("通信エラーが発生しました");
      setState("error");
    }
  }

  /** 数値入力の表(0を許す項目) */
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

  /**
   * 未入力を残せる入力の表。足し算式(1200+340)をそのまま書けるので、
   * 請求書の明細を電卓で合計してから転記する手間が要らない。
   */
  function renderOptionalTable(
    fields: readonly { field: OptionalField; label: string }[],
    emptyHint: string,
  ) {
    return (
      <div className="rounded-md border border-line">
        <div className="max-h-[50vh] overflow-y-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-subtle">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-bold text-ink-muted">車番</th>
                {fields.map((f) => (
                  <th key={f.field} className="px-3 py-2 text-right text-xs font-bold text-ink-muted">
                    {f.label}(円)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.vehicleNo} className="border-t border-line align-top">
                  <td className="px-3 py-2 num">{v.vehicleNo}</td>
                  {fields.map((f) => {
                    const raw = optional[f.field][v.vehicleNo] ?? "";
                    const sum = parseSumExpression(raw);
                    const isExpression = raw.includes("+") || raw.includes("＋");
                    const isInvalid = raw.trim() !== "" && sum === null;
                    return (
                      <td key={f.field} className="px-3 py-2 text-right">
                        <input
                          data-step-field
                          type="text"
                          inputMode="decimal"
                          // 「足し算のまま書ける」ことは説明文ではなく placeholder で予告する
                          placeholder="1200+340"
                          value={raw}
                          onChange={(e) => setOptionalValue(f.field, v.vehicleNo, e.target.value)}
                          onKeyDown={handleEnterMovesNext}
                          className={`num w-36 rounded-md border px-2 py-1 text-right ${
                            isInvalid ? "border-danger" : "border-line"
                          }`}
                        />
                        {isExpression && sum !== null ? (
                          <p className="num mt-0.5 text-[11px] text-ink-muted">
                            = {sum.toLocaleString("ja-JP")}
                          </p>
                        ) : null}
                        {isInvalid ? (
                          <p className="mt-0.5 text-[11px] text-danger">
                            数字と + だけで入力してください
                          </p>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line bg-subtle px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
          {emptyHint}
        </p>
      </div>
    );
  }

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step] ?? STEPS[0]!;

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        if (isLast) void post(false);
      }}
      className="flex flex-col gap-6"
    >
      {/*
        現在地を「1/6」の文字ではなくレールで見せる。
        済 (✓) / 現在 / 未着手 を色と記号の両方で描き分け、色だけに頼らない。
        押せば直接跳べる — 請求書は届いた順に処理するので、順番に進むとは限らない。
      */}
      <ol className="flex flex-wrap items-center gap-1.5">
        {STEPS.map((s, i) => {
          const state = i < step ? "done" : i === step ? "current" : "todo";
          return (
            <li key={s.label}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={state === "current" ? "step" : undefined}
                className={[
                  "pressable flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs",
                  state === "current"
                    ? "border-brand bg-brand font-bold text-white"
                    : state === "done"
                      ? "border-brand-soft bg-brand-soft font-semibold text-brand-deep"
                      : "border-line bg-white text-ink-muted hover:bg-subtle",
                ].join(" ")}
              >
                <span className="num" aria-hidden>
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span>{s.label}</span>
              </button>
            </li>
          );
        })}
        <li className="num ml-auto text-xs text-ink-muted">
          {yearMonth}
          {current.workflowId !== null ? ` ・ STEP ${current.workflowId}` : ""}
        </li>
      </ol>

      {restored ? (
        <p className="rounded-md border border-line bg-subtle px-4 py-2 text-xs text-ink-muted">
          保存した入力を読み込みました。続きから入力できます。
        </p>
      ) : null}

      <section className="rise-in rounded-xl border border-line bg-white p-5">
        {step === 0 ? (
          <div>
            <h2 className="text-sm font-bold text-ink">キリンの輸送協力金・経営支援金</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-ink">
                輸送協力金(円)
                {/* placeholder が「足し算で書ける」ことを説明文なしで予告する */}
                <input
                  data-step-field
                  type="text"
                  inputMode="decimal"
                  placeholder="1200+340"
                  value={kirinTransport}
                  onChange={(e) => setKirinTransport(e.target.value)}
                  onKeyDown={handleEnterMovesNext}
                  className="num rounded-md border border-line px-3 py-2 text-right text-lg"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink">
                経営支援金(円)
                <input
                  data-step-field
                  type="text"
                  inputMode="decimal"
                  placeholder="1200+340"
                  value={kirinManagement}
                  onChange={(e) => setKirinManagement(e.target.value)}
                  onKeyDown={handleEnterMovesNext}
                  className="num rounded-md border border-line px-3 py-2 text-right text-lg"
                />
              </label>
            </div>
            {/* 説明文ではなく「結果の数字」で何が起きるかを見せる (このステップの主役) */}
            <div className="mt-4 rounded-lg bg-brand-soft px-4 py-3">
              <p className="text-xs text-ink-muted">
                {parseVehicleNoList(kirinTargets).join("番・") || "—"}番へ それぞれ
              </p>
              <p className="num mt-0.5 text-3xl font-bold text-ink">
                {Math.floor(
                  ((parseSumExpression(kirinTransport) ?? 0) +
                    (parseSumExpression(kirinManagement) ?? 0)) /
                    Math.max(parseVehicleNoList(kirinTargets).length, 1),
                ).toLocaleString("ja-JP")}
                <span className="ml-0.5 text-base font-semibold text-ink-muted">円</span>
              </p>
              <p className="mt-0.5 text-[11px] text-ink-muted">端数は先頭の車番へ</p>
            </div>

            <details className="mt-3 rounded-md border border-line bg-subtle px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-ink">
                配分先の車番を変える(いまは {parseVehicleNoList(kirinTargets).join("・") || "未設定"})
              </summary>
              <label className="mt-2 flex flex-col gap-1 text-xs text-ink">
                専属車両の車番(カンマ区切り)
                <input
                  type="text"
                  inputMode="numeric"
                  value={kirinTargets}
                  onChange={(e) => setKirinTargets(e.target.value)}
                  className="num w-40 rounded-md border border-line bg-white px-3 py-2"
                />
              </label>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                設定は保存され、翌月以降もこの車番に配分されます。他の車両のキリン配送はスポット運行のため対象外です。
              </p>
            </details>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-bold text-ink">燃料費</h2>
            <label className="flex flex-col gap-1 text-xs text-ink">
              インタンク単価(円/ℓ)
              <input
                data-step-field
                type="number"
                inputMode="decimal"
                min={0}
                value={tankPrice}
                onChange={(e) => setTankPrice(Number(e.target.value) || 0)}
                onKeyDown={handleEnterMovesNext}
                className="num w-40 rounded-md border border-line px-3 py-2 text-right text-lg"
              />
              <span className="text-[11px] text-ink-muted">全車の軽油代を自動計算</span>
            </label>
            {renderVehicleTable("fuelInQty", "インタンク給油量", "ℓ")}
            {renderVehicleTable("fuelOut", "外部給油代", "円")}
            {renderVehicleTable("fuelOutQty", "外部給油量", "ℓ")}
            {renderVehicleTable("adblue", "アドブルー", "円")}
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <h2 className="text-sm font-bold text-ink">人件費(給与集計表)の取込確認</h2>
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
                  href="/import"
                  className="pressable rounded-md border border-brand px-3 py-1.5 text-xs font-semibold text-brand-deep hover:bg-brand-soft"
                >
                  データ取込へ
                </Link>
              </div>
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

        {step === 3 ? (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-bold text-ink">修繕費・タイヤ</h2>
            {renderOptionalTable(
              [{ field: "tireActual", label: "タイヤ代(実費)" }],
              "空欄 = 走行距離 × タイヤ単価で自動計算 / 0 = 今月はタイヤ代なしとして確定",
            )}
            {renderVehicleTable("repairActual", "修繕費(実費)", "円")}
            {renderVehicleTable("equip", "備品費", "円")}
            {renderVehicleTable("mainte", "メンテ費", "円")}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-bold text-ink">高速料金</h2>
            {renderOptionalTable(
              [
                { field: "tollActual", label: "通行料金(実費)" },
                { field: "tollDiscountActual", label: "割引額" },
              ],
              "空欄 = 売上モニタリストの通行料金 × 組合割引率で自動計算",
            )}
          </div>
        ) : null}

        {isLast ? (
          <div>
            <h2 className="text-sm font-bold text-ink">確認して確定</h2>
            <p className="mt-1 text-xs text-ink-muted">何度でもやり直せます</p>
            <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-2 text-sm">
              <dt className="text-xs text-ink-muted">対象車両</dt>
              <dd className="num text-ink">{vehicles.length}台</dd>
              <dt className="text-xs text-ink-muted">インタンク単価</dt>
              <dd className="num text-ink">{tankPrice.toLocaleString("ja-JP")}円/ℓ</dd>
              <dt className="text-xs text-ink-muted">タイヤ実費の入力</dt>
              <dd className="num text-ink">
                {Object.values(optional.tireActual).filter((s) => parseSumExpression(s) !== null)
                  .length}
                台
              </dd>
              <dt className="text-xs text-ink-muted">高速実費の入力</dt>
              <dd className="num text-ink">
                {Object.values(optional.tollActual).filter((s) => parseSumExpression(s) !== null)
                  .length}
                台
              </dd>
              <dt className="text-xs text-ink-muted">給与取込</dt>
              <dd className="text-ink">
                {payrollStatus ? "取込済み" : "未取込"}
                {payrollConfirmed ? "(確認済み)" : ""}
              </dd>
            </dl>
            {submitState === "done" ? (
              <div className="mt-3 rounded-md border border-line bg-subtle px-4 py-3 text-sm text-ink">
                収支表を作り直しました。月次収支表に反映されています。
              </div>
            ) : null}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-3 rounded-md border border-caution-border bg-caution-soft px-4 py-3 text-xs">
            {errorMessage}
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="pressable rounded-md border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-subtle disabled:opacity-50"
        >
          戻る
        </button>

        {/* 請求書が全部揃う前に閉じても入力が消えないようにする。どのステップからでも押せる。 */}
        <button
          type="button"
          disabled={saveState === "pending"}
          onClick={() => void post(true)}
          className="pressable rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand-deep hover:bg-brand-soft disabled:opacity-50"
        >
          {saveState === "pending" ? "保存しています…" : "ここまでを保存"}
        </button>
        {saveState === "done" ? <span className="text-xs text-ink-muted">保存しました</span> : null}

        <div className="ml-auto">
          {isLast ? (
            <button
              type="submit"
              disabled={submitState === "pending"}
              className="pressable rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
            >
              {submitState === "pending" ? "計算しています…" : "収支表を作り直す"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="pressable rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-deep"
            >
              次へ
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
