"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../../_components/EmptyState";
import { ListToolbar } from "../../_components/ListToolbar";

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

export interface PayrollDetailRow {
  vehicleNo: string;
  vehicleType: string;
  depot: string;
  driverName: string | null;
  driverCount: number;
  salary: number;
  welfare: number;
}

/**
 * 請求書・レシートを見て人が入力する項目。
 * 業務フロー docx の STEP3(燃料費)・STEP5(修繕費・タイヤ)・STEP6(高速料金)に対応する。
 * これ以外の値は取込CSVかマスタから来るため、ここには置かない(下流は手入力させない原則)。
 */
export type FieldKey =
  | "fuelInQty"
  | "fuelOutQty"
  | "fuelOut"
  | "adblue"
  | "repairActual"
  | "tireActual"
  | "tollActual"
  | "tollDiscountActual";

interface FieldDef {
  key: FieldKey;
  label: string;
  unit: string;
  /**
   * 空欄のまま確定してよい項目。
   * true の項目は「未入力(null)」として送り、自動計算(標準原価・近似計算)にフォールバックする。
   * false の項目の空欄は「その車両は0円」として送る。
   * 0で潰すか未入力で残すかを取り違えると、請求書に載っていない車両を0円で確定してしまう。
   */
  keepsBlank: boolean;
  /** 請求書のどこから写す欄か。列見出しの直下に常時出す(視線を動かさずに出所が分かる) */
  source: string;
}

const FUEL_FIELDS: readonly FieldDef[] = [
  { key: "fuelInQty", label: "インタンク給油量", unit: "ℓ", keepsBlank: false, source: "給油機のレシート" },
  { key: "fuelOutQty", label: "外部給油量", unit: "ℓ", keepsBlank: false, source: "各社の請求書" },
  { key: "fuelOut", label: "外部給油代", unit: "円", keepsBlank: false, source: "各社の請求書" },
  { key: "adblue", label: "アドブルー", unit: "円", keepsBlank: false, source: "記載があれば" },
];

/**
 * 備品費・メンテ費は業務フロー docx に対応する手順が無い(どの紙から写すのか誰も答えられない)。
 * 欄があるだけで「埋めなければいけないのか」と手が止まるため、入力欄からは外し、
 * 既存の値は miscOther と同じく持ち回して保存のたびに0で消えないようにする。
 */
const EXPENSE_FIELDS: readonly FieldDef[] = [
  { key: "repairActual", label: "修繕費", unit: "円", keepsBlank: false, source: "各社の請求書" },
  { key: "tireActual", label: "タイヤ代", unit: "円", keepsBlank: true, source: "各社の請求書" },
];

const TOLL_FIELDS: readonly FieldDef[] = [
  { key: "tollActual", label: "通行料金", unit: "円", keepsBlank: true, source: "高速協の請求書" },
  { key: "tollDiscountActual", label: "割引額", unit: "円", keepsBlank: true, source: "高速協の請求書" },
];

/** 入力欄を持たない持ち回し項目(保存のたびに0で消さないためだけに保持する) */
type CarriedKey = "equip" | "mainte";

type FieldValues = Record<FieldKey, Record<string, string>>;

const ALL_FIELD_KEYS: readonly FieldKey[] = [
  ...FUEL_FIELDS,
  ...EXPENSE_FIELDS,
  ...TOLL_FIELDS,
].map((f) => f.key);

function emptyFieldValues(): FieldValues {
  return Object.fromEntries(ALL_FIELD_KEYS.map((k) => [k, {}])) as FieldValues;
}

/** 0は「まだ触っていない」と見分けがつかないので空欄で出す。実際に0円と入力した値だけが残る。 */
function toRawMap(source: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [vehicleNo, value] of Object.entries(source)) {
    if (value !== 0) out[vehicleNo] = String(value);
  }
  return out;
}

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

/**
 * 請求書のExcelから「車番 金額」を範囲コピーして貼り付けた文字列を行に分解する。
 *
 * 元のExcel業務が「ピボットの結果を範囲コピーして貼る」だったので、同じ操作を残す。
 * 区切りはタブ優先。金額の桁区切りカンマを壊さないため、カンマでは分割しない。
 */
export interface PastedRow {
  vehicleNo: string;
  values: string[];
}

export function parsePastedRows(text: string): PastedRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const cells = (line.includes("\t") ? line.split("\t") : line.split(/[\s、]+/)).map((c) =>
        c.trim(),
      );
      return { vehicleNo: cells[0] ?? "", values: cells.slice(1) };
    })
    .filter((row) => row.vehicleNo !== "" && row.values.length > 0);
}

/**
 * IME確定中のEnterでは送らず、通常のEnterは次の欄へ移動する(誤送信防止・design-system規律)。
 *
 * 表の中では「同じ列の次の車両」へ進む。請求書は1種類の金額が縦に並んでいるので、
 * 紙を上から順に読みながら1列を打ち切れる。列の最後まで来たら次の列の先頭へ折り返す。
 */
function handleEnterMovesNext(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter") return;
  if (e.nativeEvent.isComposing) return;
  e.preventDefault();
  const form = e.currentTarget.form;
  if (!form) return;
  const inputs = Array.from(form.querySelectorAll<HTMLInputElement>("input[data-step-field]"));
  const col = e.currentTarget.dataset.col;
  if (col === undefined) {
    const next = inputs[inputs.indexOf(e.currentTarget) + 1];
    if (next) next.focus();
    return;
  }
  const sameColumn = inputs.filter((el) => el.dataset.col === col);
  const nextInColumn = sameColumn[sameColumn.indexOf(e.currentTarget) + 1];
  if (nextInColumn) {
    nextInColumn.focus();
    return;
  }
  const nextColumn = inputs.find((el) => el.dataset.col === String(Number(col) + 1));
  if (nextColumn) nextColumn.focus();
}

/** 「24,300」「24 300」「24、300」いずれの書き方でも車番の並びとして受ける */
function parseVehicleNoList(raw: string): string[] {
  return raw
    .split(/[,、\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * 車番・運転者検索の全角/半角ゆらぎを吸収する。
 * NFKC正規化で全角英数字・全角スペースを半角化してから小文字化して比較する
 * (「２４」でも「24」でも同じ車両がヒットするようにする)。
 */
function normalizeSearchText(raw: string): string {
  return raw.normalize("NFKC").toLowerCase();
}

/**
 * 画面のステップ = 業務フロー docx のステップ。
 * システム都合の並びにせず、手順書と同じ番号・同じ言葉で並べる(現在地を見失わせない)。
 * fields は「そのステップで請求書から書き写す欄」。1台1行にまとめて、請求書を上から順に消化できるようにする。
 */
const STEPS: readonly {
  workflowId: number | null;
  label: string;
  fields: readonly FieldDef[];
}[] = [
  { workflowId: 2, label: "キリンの協力金", fields: [] },
  { workflowId: 3, label: "燃料費", fields: FUEL_FIELDS },
  { workflowId: 4, label: "人件費の確認", fields: [] },
  { workflowId: 5, label: "修繕費・タイヤ", fields: EXPENSE_FIELDS },
  { workflowId: 6, label: "高速料金", fields: TOLL_FIELDS },
  { workflowId: null, label: "確認して確定", fields: [] },
];

/** ?step=3 のような業務フロー番号を、画面のステップ位置に読み替える */
function initialIndexFromWorkflowStep(step: string | null | undefined): number {
  const id = Number(step);
  const idx = STEPS.findIndex((s) => s.workflowId === id);
  return idx >= 0 ? idx : 0;
}

type EntryFilter = "all" | "filled" | "unfilled";

export function ManualEntryStepper({
  yearMonth,
  vehicles,
  prefill,
  payrollStatus,
  payrollDetail = [],
  initialWorkflowStep = null,
  autoValues = { tireActual: {}, tollActual: {} },
  tollDiscountRate = 0,
  prevTankPricePerLiter = 0,
  operatedVehicleCount = 0,
  canManageVehicleMaster = false,
}: {
  yearMonth: string;
  vehicles: VehicleRow[];
  prefill: PrefillValues;
  payrollStatus: PayrollStatus;
  payrollDetail?: PayrollDetailRow[];
  initialWorkflowStep?: string | null;
  /** 空欄にしたときに使われる自動計算の金額。規則を文章で説明せず、この数字をセルに出す */
  autoValues?: { tireActual: Record<string, number>; tollActual: Record<string, number> };
  /** 割引額の空欄に使う組合割引率。通行料金の入力に反応して割引額の自動値を出す */
  tollDiscountRate?: number;
  /** 前月のインタンク単価。今月が未設定(0)のときにワンタップで引き継げるようにする */
  prevTankPricePerLiter?: number;
  /** その月の運行実績CSVに出てきた車番の数。車両マスタが空のとき「何台ぶん取りこぼしているか」を示す */
  operatedVehicleCount?: number;
  /** 車両マスタの取込画面へ行ける権限があるか。無い人にリンクだけ出すと行き止まりになる */
  canManageVehicleMaster?: boolean;
}) {
  const [step, setStep] = useState(() => initialIndexFromWorkflowStep(initialWorkflowStep));
  const [values, setValues] = useState<FieldValues>(() => ({
    ...emptyFieldValues(),
    fuelInQty: toRawMap(prefill.fuelInQty),
    fuelOutQty: toRawMap(prefill.fuelOutQty),
    fuelOut: toRawMap(prefill.fuelOut),
    adblue: toRawMap(prefill.adblue),
    repairActual: toRawMap(prefill.repairActual),
  }));
  // その他諸経費・備品費・メンテ費は入力欄を持たない(業務フローに対応する手順が無い)が、
  // 既に入っている値を保存のたびに0で消さないよう、そのまま持ち回して送り返す。
  const [carried, setCarried] = useState<Record<CarriedKey | "miscOther", Record<string, number>>>({
    equip: prefill.equip,
    mainte: prefill.mainte,
    miscOther: prefill.miscOther,
  });
  const [tankPrice, setTankPrice] = useState(prefill.tankPricePerLiter);
  const [kirinTransport, setKirinTransport] = useState("");
  const [kirinManagement, setKirinManagement] = useState("");
  // 配分先の車番は専属契約が変われば変わるので、コード定数ではなく設定として持つ
  const [kirinTargets, setKirinTargets] = useState("24,300");
  const [restored, setRestored] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [savedVehicleCount, setSavedVehicleCount] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [entryFilter, setEntryFilter] = useState<EntryFilter>("all");
  const [pasteResult, setPasteResult] = useState("");
  // 貼り付けは一度に何十台も書き換わるので、直前の状態を取っておいて取り消せるようにする。
  const [pasteUndo, setPasteUndo] = useState<FieldValues | null>(null);
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step] ?? STEPS[0]!;
  const stepFields = current.fields;
  const hasVehicles = vehicles.length > 0;

  /** そのステップの欄が1つでも埋まっていれば「入力済み」。0円と入力した車両も入力済みに含む。 */
  function isEntered(vehicleNo: string): boolean {
    return stepFields.some((f) => (values[f.key][vehicleNo] ?? "").trim() !== "");
  }

  // 車両テーブルは何十行にもなるので、車番・運転者名での絞り込みと
  // 「未入力のみ / 入力済みのみ」の切り替えを用意する。請求書に載っている車両だけを見て進められる。
  const filteredVehicles = useMemo(() => {
    const query = normalizeSearchText(vehicleSearch.trim());
    return vehicles.filter((v) => {
      if (
        query &&
        !normalizeSearchText(v.vehicleNo).includes(query) &&
        !normalizeSearchText(v.driver ?? "").includes(query)
      ) {
        return false;
      }
      if (entryFilter === "all" || stepFields.length === 0) return true;
      const entered = stepFields.some((f) => (values[f.key][v.vehicleNo] ?? "").trim() !== "");
      return entryFilter === "filled" ? entered : !entered;
    });
  }, [vehicles, vehicleSearch, entryFilter, stepFields, values]);

  const enteredCount = useMemo(
    () => (stepFields.length === 0 ? 0 : vehicles.filter((v) => isEntered(v.vehicleNo)).length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicles, stepFields, values],
  );

  /** 確認ステップ用。項目ごとに「入力した金額の合計」と「入力した台数」を出す。 */
  const summary = useMemo(() => {
    const out = {} as Record<FieldKey, { sum: number; count: number }>;
    for (const key of ALL_FIELD_KEYS) {
      let sum = 0;
      let count = 0;
      for (const v of vehicles) {
        const parsed = parseSumExpression(values[key][v.vehicleNo] ?? "");
        if (parsed === null) continue;
        sum += parsed;
        count += 1;
      }
      out[key] = { sum, count };
    }
    return out;
  }, [vehicles, values]);

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
          kirin?: { transportSupport?: number; managementSupport?: number };
        };
        if (aborted) return;
        if (data.kirinTargetVehicleNos && data.kirinTargetVehicleNos.length > 0) {
          setKirinTargets(data.kirinTargetVehicleNos.join(","));
        }
        // 金額を読み戻さないと、片方だけ直して保存したときにもう片方が0で上書きされて消える。
        if (data.kirin) {
          if (data.kirin.transportSupport) setKirinTransport(String(data.kirin.transportSupport));
          if (data.kirin.managementSupport) setKirinManagement(String(data.kirin.managementSupport));
        }
        const rows = data.manualInputs ?? [];
        if (rows.length === 0) return;

        setValues((prev) => {
          const next: FieldValues = emptyFieldValues();
          for (const key of ALL_FIELD_KEYS) next[key] = { ...prev[key] };
          /*
            保存すると全車両の行が書かれ、入力していない欄には0が入る
            (manual_vehicle_input の該当列は NOT NULL default 0 で、未入力をDBに保存できない)。
            その0をそのまま読み戻すと、一度保存しただけで全車両が「入力済み」になり、
            「未入力のみ」の絞り込みが常に0件になって、表が壊れたように見えていた。
            0円と空欄はどちらも同じ計算結果(0円)なので、空欄として読み戻すのが正しい。
          */
          const blankIfZero = (key: FieldKey, vehicleNo: string, value: number) => {
            if (value === 0) delete next[key][vehicleNo];
            else next[key][vehicleNo] = String(value);
          };
          for (const r of rows) {
            blankIfZero("fuelInQty", r.vehicleNo, r.fuelInQty);
            blankIfZero("fuelOutQty", r.vehicleNo, r.fuelOutQty);
            blankIfZero("fuelOut", r.vehicleNo, r.fuelOut);
            blankIfZero("adblue", r.vehicleNo, r.adblue);
            blankIfZero("repairActual", r.vehicleNo, r.repairActual);
            // 自動計算にフォールバックする項目だけは 0 に意味がある(「今月は実費なし」)ので残す。
            if (r.tireActual !== null) next.tireActual[r.vehicleNo] = String(r.tireActual);
            if (r.tollActual !== null) next.tollActual[r.vehicleNo] = String(r.tollActual);
            if (r.tollDiscountActual !== null) {
              next.tollDiscountActual[r.vehicleNo] = String(r.tollDiscountActual);
            }
          }
          return next;
        });
        setCarried((prev) => {
          const next = { equip: { ...prev.equip }, mainte: { ...prev.mainte }, miscOther: { ...prev.miscOther } };
          for (const r of rows) {
            next.equip[r.vehicleNo] = r.equip;
            next.mainte[r.vehicleNo] = r.mainte;
            next.miscOther[r.vehicleNo] = r.miscOther;
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

  function setValue(field: FieldKey, vehicleNo: string, raw: string) {
    setValues((prev) => ({ ...prev, [field]: { ...prev[field], [vehicleNo]: raw } }));
    markDirty();
  }

  /** 保存していない変更があることを覚えておく。「保存しました」を出しっぱなしにしない。 */
  function markDirty() {
    setDirty(true);
    setSaveState((s) => (s === "done" ? "idle" : s));
  }

  function buildPayload(saveOnly: boolean) {
    /** 空欄 = 0円として確定する項目 */
    const num = (field: FieldKey, vehicleNo: string) =>
      parseSumExpression(values[field][vehicleNo] ?? "") ?? 0;
    /** 空欄 = 未入力として残す項目(自動計算にフォールバックさせる) */
    const opt = (field: FieldKey, vehicleNo: string) =>
      parseSumExpression(values[field][vehicleNo] ?? "");

    const manualInputs = vehicles.map((v) => ({
      vehicleNo: v.vehicleNo,
      repairActual: num("repairActual", v.vehicleNo),
      fuelOut: num("fuelOut", v.vehicleNo),
      fuelOutQty: num("fuelOutQty", v.vehicleNo),
      fuelInQty: num("fuelInQty", v.vehicleNo),
      adblue: num("adblue", v.vehicleNo),
      equip: carried.equip[v.vehicleNo] ?? 0,
      mainte: carried.mainte[v.vehicleNo] ?? 0,
      miscOther: carried.miscOther[v.vehicleNo] ?? 0,
      tireActual: opt("tireActual", v.vehicleNo),
      tollActual: opt("tollActual", v.vehicleNo),
      tollDiscountActual: opt("tollDiscountActual", v.vehicleNo),
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
      const data = (await res.json()) as { error?: string; vehicleCount?: number };
      if (!res.ok) {
        setErrorMessage(data.error ?? (saveOnly ? "保存に失敗しました" : "送信に失敗しました"));
        setState("error");
        return;
      }
      if (!saveOnly) setSavedVehicleCount(data.vehicleCount ?? 0);
      setDirty(false);
      setState("done");
    } catch {
      setErrorMessage("通信エラーが発生しました");
      setState("error");
    }
  }

  /**
   * 請求書のExcelから「車番 金額」をまとめて貼り付ける。
   * 表のどこに貼っても効く。列の並びはその表の見出しの順。
   * 車両マスタに無い車番は反映せず、件数を出して人に気づかせる(黙って捨てない)。
   */
  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const text = e.clipboardData.getData("text/plain");
    const rows = parsePastedRows(text);
    if (rows.length === 0) return;

    const knownVehicleNos = new Map(
      vehicles.map((v) => [normalizeSearchText(v.vehicleNo), v.vehicleNo]),
    );
    const applied: Record<FieldKey, Record<string, string>> = emptyFieldValues();
    let appliedCount = 0;
    const unknown: string[] = [];

    for (const row of rows) {
      const vehicleNo = knownVehicleNos.get(normalizeSearchText(row.vehicleNo));
      if (!vehicleNo) {
        unknown.push(row.vehicleNo);
        continue;
      }
      row.values.forEach((value, i) => {
        const field = stepFields[i];
        if (!field || value === "") return;
        applied[field.key][vehicleNo] = value;
      });
      appliedCount += 1;
    }
    if (appliedCount === 0 && unknown.length === 0) return;

    e.preventDefault();
    setValues((prev) => {
      setPasteUndo(prev);
      const next: FieldValues = emptyFieldValues();
      for (const key of ALL_FIELD_KEYS) next[key] = { ...prev[key], ...applied[key] };
      return next;
    });
    markDirty();
    // 何列目がどの項目に入ったかを必ず言う。列がずれたまま気づかず確定するのが一番怖い。
    const usedColumns = stepFields
      .slice(0, Math.max(...rows.map((r) => r.values.length)))
      .map((f, i) => `${i + 2}列目→${f.label}`)
      .join(" / ");
    setPasteResult(
      [
        `${appliedCount}台に貼り付けました(1列目→車番 / ${usedColumns})`,
        unknown.length === 0
          ? ""
          : `車両マスタに無い車番${unknown.length}件は反映していません(${unknown.slice(0, 5).join("・")}${unknown.length > 5 ? "ほか" : ""})`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  function undoPaste() {
    if (!pasteUndo) return;
    setValues(pasteUndo);
    setPasteUndo(null);
    setPasteResult("貼り付けを取り消しました");
  }

  /**
   * 空欄のまま確定したときに使われる金額。
   * 「空欄は自動計算されます」と説明する代わりに、この数字をその欄に出す。
   * 規則を覚えなくても、いくらになるかがその場で読める。
   */
  function autoAmount(key: FieldKey, vehicleNo: string): number | null {
    if (key === "tireActual") return autoValues.tireActual[vehicleNo] ?? null;
    if (key === "tollActual") return autoValues.tollActual[vehicleNo] ?? null;
    if (key === "tollDiscountActual") {
      const toll =
        parseSumExpression(values.tollActual[vehicleNo] ?? "") ??
        autoValues.tollActual[vehicleNo] ??
        null;
      if (toll === null) return null;
      return Math.round(toll * tollDiscountRate);
    }
    return null;
  }

  /** 請求書から書き写す欄の表。1台1行で、Enterを押すと同じ列の次の車両へ進む。 */
  function renderFieldTable(fields: readonly FieldDef[]) {
    return (
      <div className="rounded-md border border-line">
        <div className="max-h-[50vh] overflow-auto" onPaste={handlePaste}>
          {filteredVehicles.length === 0 ? (
            <div className="p-4">
              {!hasVehicles ? (
                <EmptyState
                  title="入力できる車両がまだありません"
                  description={
                    canManageVehicleMaster
                      ? "車両マスタが未登録のため、車両の一覧を作れません。車両マスタを取り込むと、ここに全車両が並びます。"
                      : "車両マスタが未登録のため、車両の一覧を作れません。管理者に車両マスタの登録を依頼してください。"
                  }
                  actionHref="/admin/vehicle-master"
                  actionLabel="車両マスタの登録へ"
                />
              ) : (
                <div className="rounded-xl border border-dashed border-line bg-white px-6 py-10 text-center">
                  <p className="text-sm font-semibold text-ink">
                    {vehicleSearch.trim() !== ""
                      ? `「${vehicleSearch.trim()}」に一致する車両がありません`
                      : "条件に合う車両がありません"}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    車番・運転者名のどちらでも探せます。全角でも半角でも構いません。
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setVehicleSearch("");
                      setEntryFilter("all");
                    }}
                    className="pressable mt-4 rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand-deep hover:bg-brand-soft"
                  >
                    絞り込みを解除して全車両を表示
                  </button>
                </div>
              )}
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-subtle">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-bold text-ink-muted">車番</th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-ink-muted">運転者</th>
                  {fields.map((f) => (
                    <th
                      key={f.key}
                      className="px-3 py-2 text-right text-xs font-bold text-ink-muted whitespace-nowrap"
                    >
                      {f.label}({f.unit})
                      {/* どの紙から写す欄かを、視線を動かさずに読める位置に常時置く */}
                      <span className="block text-[11px] font-normal">{f.source}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map((v, rowIndex) => (
                  <tr key={v.vehicleNo} className="border-t border-line align-top">
                    <td className="px-3 py-2 num whitespace-nowrap">
                      {/* 入力済みかどうかは色ではなく記号でも分かるようにする */}
                      <span aria-hidden className="mr-1 text-ink-muted">
                        {isEntered(v.vehicleNo) ? "✓" : "○"}
                      </span>
                      {v.vehicleNo}
                    </td>
                    <td className="px-3 py-2">{v.driver ?? "—"}</td>
                    {fields.map((f, colIndex) => {
                      const raw = values[f.key][v.vehicleNo] ?? "";
                      const sum = parseSumExpression(raw);
                      const isInvalid = raw.trim() !== "" && sum === null;
                      const auto = raw.trim() === "" ? autoAmount(f.key, v.vehicleNo) : null;
                      return (
                        <td key={f.key} className="px-3 py-2 text-right">
                          <input
                            data-step-field
                            data-col={colIndex}
                            data-row={rowIndex}
                            type="text"
                            inputMode="decimal"
                            aria-label={`${v.vehicleNo}番の${f.label}(${f.unit})`}
                            value={raw}
                            onChange={(e) => setValue(f.key, v.vehicleNo, e.target.value)}
                            onKeyDown={handleEnterMovesNext}
                            className={`num w-32 rounded-md border px-2 py-1 text-right ${
                              isInvalid ? "border-danger" : "border-line"
                            }`}
                          />
                          {/*
                            桁を1つ間違えても数字だけでは気づけないので、読めた値をカンマ付きで返す。
                            足し算式のときは合計、そうでなければ4桁以上のときだけ(短い数字は冗長)。
                          */}
                          {sum !== null && (raw.includes("+") || raw.includes("＋") || sum >= 1000) ? (
                            <p className="num mt-0.5 text-[11px] text-ink-muted">
                              {sum.toLocaleString("ja-JP")}
                            </p>
                          ) : null}
                          {/* 空欄のままなら何円になるか。文章で規則を説明する代わりに結果を出す */}
                          {auto !== null ? (
                            <p className="num mt-0.5 text-[11px] text-ink-muted">
                              自動 {auto.toLocaleString("ja-JP")}
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
          )}
        </div>
        <div className="border-t border-line bg-subtle px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
          <p>請求書のExcelから範囲コピーして、この表に貼り付けるとまとめて入力できます。</p>
          {/*
            合算は STEP6 の割引額でしか業務上必要にならない(請求書に割引額の合計が無いため)。
            全項目の欄に「1200+340」と書いておくと、160個の見本が画面を埋めて何も伝わらない。
          */}
          {fields.some((f) => f.key === "tollDiscountActual") ? (
            <p>割引額は「1200+340」のように足し算のまま書けます(電卓は不要です)。</p>
          ) : null}
          {fields.every((f) => !f.keepsBlank) ? <p>空欄の車両は0円として確定します。</p> : null}
        </div>
      </div>
    );
  }

  /** 検索・絞り込みと「表示◯台 / 全◯台」。0行のときも母数が読めるので、検索の不具合と取り違えない。 */
  function renderToolbar() {
    return (
      <div className="flex flex-col gap-2">
        <ListToolbar
          searchValue={vehicleSearch}
          onSearchChange={setVehicleSearch}
          searchPlaceholder="車番・運転者で検索"
          filterChips={[
            { key: "unfilled", label: "未入力のみ", active: entryFilter === "unfilled" },
            { key: "filled", label: "入力済みのみ", active: entryFilter === "filled" },
          ]}
          onToggleFilter={(key) =>
            setEntryFilter((prev) => (prev === key ? "all" : (key as EntryFilter)))
          }
        />
        <p className="num text-xs text-ink-muted">
          表示 {filteredVehicles.length}台 / 全 {vehicles.length}台 ・ 入力済み {enteredCount}台
        </p>
        {pasteResult ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-subtle px-3 py-2 text-xs text-ink">
            <span>{pasteResult}</span>
            {pasteUndo ? (
              <button
                type="button"
                onClick={undoPaste}
                className="pressable rounded-md border border-brand px-3 py-1 font-semibold text-brand-deep hover:bg-brand-soft"
              >
                貼り付けを取り消す
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

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
        ステップを移ったら絞り込みは解除する。前のステップの検索語が残っていると、
        次の表が理由なく数行しか出ず「表が壊れた」ように見えるため。
      */}
      <ol className="flex flex-wrap items-center gap-1.5">
        {STEPS.map((s, i) => {
          const state = i < step ? "done" : i === step ? "current" : "todo";
          return (
            <li key={s.label}>
              <button
                type="button"
                onClick={() => {
                  setStep(i);
                  setVehicleSearch("");
                  setEntryFilter("all");
                  setPasteResult("");
                }}
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
                {/*
                  番号は業務フロー docx の STEP 番号に揃える。画面独自の通し番号を併記すると
                  「STEP5 なのに 4番目」のように2つの番号が食い違い、現在地が分からなくなる。
                */}
                <span className="num" aria-hidden>
                  {state === "done" ? "✓" : (s.workflowId ?? "最後")}
                </span>
                <span>{s.label}</span>
              </button>
            </li>
          );
        })}
        <li className="num ml-auto text-xs text-ink-muted">{yearMonth}</li>
      </ol>

      {/*
        車両が0台のときは、入力しても収支表に1行も反映されない。
        黙って空の表を出すと「検索が壊れている」と読まれるので、先に理由と次の一手を出す。
      */}
      {!hasVehicles ? (
        <div className="rounded-md border border-caution-border bg-caution-soft px-4 py-3">
          <p className="text-sm font-bold text-ink">この月に入力できる車両がありません</p>
          <p className="mt-1 text-xs leading-relaxed text-ink">
            車両マスタが1台も登録されていないため、入力しても収支表には反映されません。
            {operatedVehicleCount > 0
              ? `この月の運行実績には${operatedVehicleCount}台の車番が記録されています。`
              : ""}
          </p>
          {canManageVehicleMaster ? (
            <Link
              href="/admin/vehicle-master"
              className="pressable mt-3 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep"
            >
              車両マスタの登録へ
            </Link>
          ) : (
            <p className="mt-2 text-xs font-semibold text-ink">
              管理者に車両マスタの登録を依頼してください。
            </p>
          )}
        </div>
      ) : null}

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
                <input
                  data-step-field
                  type="text"
                  inputMode="decimal"
                  value={kirinTransport}
                  onChange={(e) => {
                    setKirinTransport(e.target.value);
                    markDirty();
                  }}
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
                  value={kirinManagement}
                  onChange={(e) => {
                    setKirinManagement(e.target.value);
                    markDirty();
                  }}
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
                  onChange={(e) => {
                    setKirinTargets(e.target.value);
                    markDirty();
                  }}
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
            <div>
              <label className="flex flex-col gap-1 text-xs text-ink">
                インタンク単価(円/ℓ)
                <input
                  data-step-field
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={tankPrice}
                  onChange={(e) => {
                    setTankPrice(Number(e.target.value) || 0);
                    markDirty();
                  }}
                  onKeyDown={handleEnterMovesNext}
                  className={`num w-40 rounded-md border px-3 py-2 text-right text-lg ${
                    tankPrice === 0 ? "border-caution-border" : "border-line"
                  }`}
                />
                <span className="text-[11px] text-ink-muted">
                  給油量 × この単価 で全車の軽油代を計算します
                </span>
              </label>
              {/*
                単価は月ごとに設定する値で、初期値が入っていない。
                0のまま進むと給油量を全部入力しても軽油代が全車0円になり、
                しかも数量は入っているので異常値チェックにも掛からない。
                ここで気づけるようにし、前月の単価をワンタップで引き継げるようにする。
              */}
              {tankPrice === 0 ? (
                <div className="mt-2 rounded-md border border-caution-border bg-caution-soft px-3 py-2">
                  <p className="text-xs font-bold text-ink">
                    単価が0のままだと、全車の軽油代が0円になります
                  </p>
                  {prevTankPricePerLiter > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setTankPrice(prevTankPricePerLiter);
                        markDirty();
                      }}
                      className="pressable num mt-2 rounded-md border border-brand bg-white px-3 py-1.5 text-xs font-semibold text-brand-deep hover:bg-brand-soft"
                    >
                      先月と同じ {prevTankPricePerLiter.toLocaleString("ja-JP")} 円/ℓ にする
                    </button>
                  ) : (
                    <p className="mt-1 text-xs text-ink">今月の仕入単価を入力してください。</p>
                  )}
                </div>
              ) : null}
            </div>
            {renderToolbar()}
            {renderFieldTable(FUEL_FIELDS)}
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
                  href={`/import?step=4&ym=${yearMonth}`}
                  className="pressable rounded-md border border-brand px-3 py-1.5 text-xs font-semibold text-brand-deep hover:bg-brand-soft"
                >
                  データ取込へ
                </Link>
              </div>
            )}
            {payrollDetail.length > 0 ? (
              <div className="mt-4">
                <h3 className="text-xs font-bold text-ink-muted">車両別内訳(社員コード→運転者マスタ→車両で集計)</h3>
                <div className="mt-1.5 max-h-[40vh] overflow-y-auto rounded-md border border-line">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-subtle">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-bold text-ink-muted">車番</th>
                        <th className="px-3 py-2 text-left text-xs font-bold text-ink-muted">運転者</th>
                        <th className="px-3 py-2 text-right text-xs font-bold text-ink-muted">総支給額</th>
                        <th className="px-3 py-2 text-right text-xs font-bold text-ink-muted">社保合計</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payrollDetail.map((row) => (
                        <tr key={row.vehicleNo} className="border-t border-line">
                          <td className="px-3 py-2 num">{row.vehicleNo}</td>
                          <td className="px-3 py-2">
                            {row.driverName ?? <span className="text-danger">未割当</span>}
                          </td>
                          <td className="px-3 py-2 text-right num">
                            {row.salary.toLocaleString("ja-JP")}円
                          </td>
                          <td className="px-3 py-2 text-right num">
                            {row.welfare.toLocaleString("ja-JP")}円
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 text-[11px] text-ink-muted">
                  「未割当」は運転者マスタに給与データと一致する車両が見つからなかった車両です。取り漏れがないか確認してください。
                </p>
              </div>
            ) : (
              <p className="mt-4 text-xs text-ink-muted">
                車両別の内訳は、運転者マスタ(社員コードと車番の対応)を登録すると出ます。
              </p>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-bold text-ink">修繕費・タイヤ</h2>
            {renderToolbar()}
            {renderFieldTable(EXPENSE_FIELDS)}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-bold text-ink">高速料金</h2>
            {renderToolbar()}
            {renderFieldTable(TOLL_FIELDS)}
          </div>
        ) : null}

        {isLast ? (
          <div>
            <h2 className="text-sm font-bold text-ink">確認して確定</h2>
            <p className="mt-1 text-xs text-ink-muted">
              入力した金額の合計です。手元の請求書の合計額と見比べてください。何度でもやり直せます。
            </p>
            {/*
              台数だけ出しても「請求書と合っているか」は確かめられない。
              入力した金額を項目ごとに合計して、紙の合計欄と突き合わせられるようにする。
            */}
            <table className="mt-4 min-w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="py-1.5 text-left text-xs font-bold text-ink-muted">項目</th>
                  <th className="py-1.5 text-right text-xs font-bold text-ink-muted">入力した合計</th>
                  <th className="py-1.5 text-right text-xs font-bold text-ink-muted">入力した台数</th>
                </tr>
              </thead>
              <tbody>
                {[...FUEL_FIELDS, ...EXPENSE_FIELDS, ...TOLL_FIELDS].map((f) => {
                  const total = summary[f.key];
                  return (
                    <tr key={f.key} className="border-b border-line">
                      <td className="py-1.5 text-ink">
                        {f.label}
                        <span className="ml-1 text-xs text-ink-muted">({f.unit})</span>
                      </td>
                      <td className="num py-1.5 text-right font-semibold text-ink">
                        {total.sum.toLocaleString("ja-JP")}
                      </td>
                      <td className="num py-1.5 text-right text-ink-muted">
                        {total.count}台
                        {f.keepsBlank && total.count < vehicles.length ? (
                          <span className="ml-1">
                            (残り{vehicles.length - total.count}台は自動計算)
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-2 text-sm">
              <dt className="text-xs text-ink-muted">対象車両</dt>
              <dd className="num text-ink">{vehicles.length}台</dd>
              <dt className="text-xs text-ink-muted">インタンク単価</dt>
              <dd className="num text-ink">
                {tankPrice.toLocaleString("ja-JP")}円/ℓ
                {tankPrice === 0 ? (
                  <span className="ml-2 text-xs font-bold text-danger">
                    0のままです。全車の軽油代が0円になります
                  </span>
                ) : null}
              </dd>
              <dt className="text-xs text-ink-muted">キリンの配分</dt>
              <dd className="num text-ink">
                {(
                  (parseSumExpression(kirinTransport) ?? 0) +
                  (parseSumExpression(kirinManagement) ?? 0)
                ).toLocaleString("ja-JP")}
                円 を {parseVehicleNoList(kirinTargets).join("・") || "—"}番へ
              </dd>
              <dt className="text-xs text-ink-muted">給与取込</dt>
              <dd className="text-ink">{payrollStatus ? "取込済み" : "未取込"}</dd>
            </dl>
            {/*
              0台で作り直すと、収支表は1行も書き換わらないまま「成功」だけが返る。
              成功として見せると、前に入っていた古い表がそのまま残っていることに気づけない。
            */}
            {submitState === "done" && savedVehicleCount === 0 ? (
              <div className="mt-3 rounded-md border border-caution-border bg-caution-soft px-4 py-3">
                <p className="text-sm font-bold text-ink">収支表は1行も作られませんでした</p>
                <p className="mt-1 text-xs leading-relaxed text-ink">
                  車両マスタが未登録のため、計算の起点になる車両がありません。表示されている収支表は以前のデータのままです。
                </p>
              </div>
            ) : null}
            {submitState === "done" && (savedVehicleCount ?? 0) > 0 ? (
              <div className="mt-3 rounded-md border border-brand bg-brand-soft px-4 py-3">
                <p className="text-sm font-semibold text-ink">
                  {`収支表を作り直しました(${savedVehicleCount}台)。月次収支表に反映されています。`}
                </p>
                <p className="mt-1 text-xs text-ink-muted">続けて、収支表のチェック(STEP7)で異常値を確認してください</p>
                <Link
                  href={`/anomaly?ym=${yearMonth}`}
                  className="pressable mt-3 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep"
                >
                  次へ: 収支表のチェックに進む
                </Link>
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
          disabled={saveState === "pending" || !hasVehicles}
          onClick={() => void post(true)}
          className="pressable rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand-deep hover:bg-brand-soft disabled:opacity-50"
        >
          {saveState === "pending" ? "保存しています…" : "ここまでを保存"}
        </button>
        {/* 保存の状態を常に正直に出す。「保存しました」を出したまま編集を続けさせない。 */}
        {saveState === "done" && !dirty ? (
          <span className="text-xs text-ink-muted">保存しました</span>
        ) : null}
        {dirty ? (
          <span className="text-xs font-semibold text-ink">保存していない入力があります</span>
        ) : null}

        <div className="ml-auto">
          {isLast ? (
            <button
              type="submit"
              disabled={submitState === "pending" || !hasVehicles}
              className="pressable rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
            >
              {submitState === "pending" ? "計算しています…" : "収支表を作り直す"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setStep((s) => Math.min(STEPS.length - 1, s + 1));
                setVehicleSearch("");
                setEntryFilter("all");
                setPasteResult("");
              }}
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
