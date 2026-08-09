"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../../_components/EmptyState";
import { ListToolbar } from "../../_components/ListToolbar";
import { NumberEntryField } from "../../_components/NumberEntryField";
import { StickyActionBar } from "../../_components/StickyActionBar";
import { StickyStepHeader } from "../../_components/StickyStepHeader";
import { parseAmountInput, parsePastedRows } from "../../_lib/numberEntry";
import {
  PayrollStep,
  type PayrollDetailRow,
  type PayrollDetailSummary,
  type PayrollStatus,
} from "./PayrollStep";

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

export type { PayrollDetailRow, PayrollDetailSummary, PayrollStatus } from "./PayrollStep";

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
 * 金額の読み取り・Excel貼り付けの分解・Enterでの移動は、この画面だけの決まりごとではなく
 * 全画面共通の作法として app/_lib/numberEntry.ts に置いた。
 * 既存の呼び出し元 (テストを含む) が壊れないよう、名前だけここから出し直す。
 */
export const parseSumExpression = parseAmountInput;
export { parsePastedRows };
export type { PastedRow } from "../../_lib/numberEntry";

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

/**
 * 前月の実績。空欄のセルのヒントと「先月の値を入れる」に使う。
 * 用意するのは請求書から書き写す欄だけ(タイヤ代・通行料金は今月の自動計算値のほうが実態に近い)。
 */
export type PreviousMonthValues = Partial<Record<FieldKey, Record<string, number>>>;

/** 先月からコピーしたセルの覚え書き。`項目:車番` の形で持ち、本人が触ったら外す。 */
function copiedKey(field: FieldKey, vehicleNo: string): string {
  return `${field}:${vehicleNo}`;
}

function draftStorageKey(yearMonth: string): string {
  return `hiragaunsou:manual-entry:${yearMonth}:v1`;
}

/** 下書きの中身。保存した時刻を必ず持つ(「いつ時点の下書きか」が言えない下書きは復元できない) */
interface EntryDraft {
  savedAt: number;
  values: FieldValues;
  /** 人が打った単価の文字列。空文字なら「先月の単価のまま」 */
  tankPriceRaw: string;
  kirinTransport: string;
  kirinManagement: string;
  kirinTargets: string;
  copied: string[];
}

function loadDraft(yearMonth: string): EntryDraft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(yearMonth));
    if (!raw) return null;
    // 単価を「数値 + 先月のままの印」で持っていた頃の下書きも読めるようにする
    const parsed = JSON.parse(raw) as Partial<EntryDraft> & {
      tankPrice?: number;
      tankPriceCarried?: boolean;
    };
    if (typeof parsed?.savedAt !== "number" || typeof parsed.values !== "object") return null;
    return {
      savedAt: parsed.savedAt,
      values: { ...emptyFieldValues(), ...parsed.values },
      tankPriceRaw:
        typeof parsed.tankPriceRaw === "string"
          ? parsed.tankPriceRaw
          : parsed.tankPriceCarried !== true &&
              typeof parsed.tankPrice === "number" &&
              parsed.tankPrice > 0
            ? String(parsed.tankPrice)
            : "",
      kirinTransport: parsed.kirinTransport ?? "",
      kirinManagement: parsed.kirinManagement ?? "",
      kirinTargets: parsed.kirinTargets ?? "",
      copied: Array.isArray(parsed.copied) ? parsed.copied : [],
    };
  } catch {
    return null;
  }
}

/** 「8月8日 10:15 時点」。日付だけだと同じ日に何度も開いたとき、どの下書きか分からない。 */
function draftStamp(ms: number): string {
  return new Date(ms).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ManualEntryStepper({
  yearMonth,
  vehicles,
  prefill,
  payrollStatus,
  payrollDetail = [],
  payrollSummary = {
    payrollRowCount: 0,
    driverMasterCount: 0,
    assignedVehicleCount: 0,
    payrollMissingVehicleCount: 0,
  },
  initialWorkflowStep = null,
  autoValues = { tireActual: {}, tollActual: {} },
  tollDiscountRate = 0,
  prevTankPricePerLiter = 0,
  previousYearMonth = "",
  previousMonthValues = {},
  isConfirmed = false,
  operatedVehicleCount = 0,
  canManageVehicleMaster = false,
}: {
  yearMonth: string;
  vehicles: VehicleRow[];
  prefill: PrefillValues;
  payrollStatus: PayrollStatus;
  payrollDetail?: PayrollDetailRow[];
  /** 0円が並ぶ理由(CSV未取込・運転者マスタ未登録・社員Noが突合しない)を名指しするための集計 */
  payrollSummary?: PayrollDetailSummary;
  initialWorkflowStep?: string | null;
  /** 空欄にしたときに使われる自動計算の金額。規則を文章で説明せず、この数字をセルに出す */
  autoValues?: { tireActual: Record<string, number>; tollActual: Record<string, number> };
  /** 割引額の空欄に使う組合割引率。通行料金の入力に反応して割引額の自動値を出す */
  tollDiscountRate?: number;
  /** 前月のインタンク単価。今月が未設定(0)のときは、これを入れた状態で開く(印を付ける) */
  prevTankPricePerLiter?: number;
  /** 前月の年月ラベル。「先月」だけだとどの月から写したのか後から分からない */
  previousYearMonth?: string;
  /** 前月の実績。空欄のヒントと「先月の値を入れる」に使う */
  previousMonthValues?: PreviousMonthValues;
  /** この月が確定済みか。確定済みの月で保存すると確定が解除されるため、先に知らせる */
  isConfirmed?: boolean;
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
  /*
    インタンク単価は月ごとの設定値で、初期値が入っていない。毎月0から始まると、
    給油量を全部入力しても軽油代が全車0円になる(数量は入っているので異常値チェックにも掛からない)。
    今月が未設定なら先月の単価を欄に入れた状態で開く。

    持つのは「人が打った文字列」だけにする。数値そのものを持つと、画面に出ている
    単価が「先月のまま」なのか「今月そう決めた」のか区別できなくなる。
    表の各欄と同じ考え方 (NumberEntryField の autoValue) で揃える。
  */
  const [tankPriceRaw, setTankPriceRaw] = useState(
    prefill.tankPricePerLiter > 0 ? String(prefill.tankPricePerLiter) : "",
  );
  /** 先月からコピーしたまま、まだ人が見ていないセル */
  const [copied, setCopied] = useState<Set<string>>(() => new Set());
  const [copyResult, setCopyResult] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(null);
  const [serverLoaded, setServerLoaded] = useState(false);
  /** 確定済みの月で保存を押したとき、「確定が解除されます」を挟むための保留 */
  const [pendingRelease, setPendingRelease] = useState<"save" | "submit" | null>(null);
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

  /** 人が単価を打っていないときに欄へ出す値 (先月の単価)。無ければ null = 空欄のまま */
  const carriedTankPrice = prevTankPricePerLiter > 0 ? prevTankPricePerLiter : null;
  /** 実際に計算へ使う単価。人が打った値 → 先月の単価 → 0 の順に決まる */
  const tankPrice = parseAmountInput(tankPriceRaw) ?? carriedTankPrice ?? 0;
  /** 先月の単価がそのまま入っていて、まだ本人が確かめていない状態 */
  const tankPriceCarried = tankPriceRaw.trim() === "" && carriedTankPrice !== null;

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

  /*
    B-2: 修繕費の空欄は 0円 として確定される (keepsBlank: false)。
    「今月は修繕なし」と「請求書を入れ忘れた」がどちらも空欄で、表の上では区別が付かない。
    どちらが正かは業務側の回答待ち (docs/product/業務確認事項.md 質問2) なので、
    計算は変えず、確定の直前に台数を数えて「0円として確定します」と出すことで区別できるようにする。
  */
  const unenteredRepairCount = useMemo(
    () => vehicles.filter((v) => (values.repairActual[v.vehicleNo] ?? "").trim() === "").length,
    [vehicles, values],
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
      } finally {
        /*
          入力途中の下書きを、保存済みの値の上に重ねる(下書きのほうが新しい編集のため)。
          先に敷き終わってからでないと、サーバの値で下書きが消される。

          確定済みの月では復元しない。締めたあとの月に古い下書きが復活すると、
          「確定したはずの月に身に覚えのない数字が入っている」という一番たちの悪い事故になる。
          復元は黙ってやらず、いつ時点の下書きかを出して破棄もできるようにする (ux-design §4-1)。
        */
        if (!aborted) {
          const draft = isConfirmed ? null : loadDraft(yearMonth);
          if (draft) {
            setValues(draft.values);
            setTankPriceRaw(draft.tankPriceRaw);
            setKirinTransport(draft.kirinTransport);
            setKirinManagement(draft.kirinManagement);
            if (draft.kirinTargets) setKirinTargets(draft.kirinTargets);
            setCopied(new Set(draft.copied));
            setDraftRestoredAt(draft.savedAt);
            // 下書きがある = 保存していない編集が残っている、なので dirty のまま出す。
            setDirty(true);
          }
          setServerLoaded(true);
        }
      }
    })();
    return () => {
      aborted = true;
    };
  }, [yearMonth, isConfirmed]);

  /** 下書きを消す(保存に成功したとき・本人が破棄したとき) */
  function clearDraft() {
    try {
      window.localStorage.removeItem(draftStorageKey(yearMonth));
    } catch {
      // 保存できない環境でも入力自体は続けられる
    }
    setDraftSavedAt(null);
    setDraftRestoredAt(null);
  }

  /** 下書きを捨てて、保存済みの状態から入力し直す */
  function discardDraft() {
    clearDraft();
    window.location.reload();
  }

  // 入力のたびに下書きを保存する。打鍵ごとに書くと重いので、手が止まってから書く。
  useEffect(() => {
    if (!serverLoaded || isConfirmed || !dirty) return;
    const timer = window.setTimeout(() => {
      const draft: EntryDraft = {
        savedAt: Date.now(),
        values,
        tankPriceRaw,
        kirinTransport,
        kirinManagement,
        kirinTargets,
        copied: Array.from(copied),
      };
      try {
        window.localStorage.setItem(draftStorageKey(yearMonth), JSON.stringify(draft));
        setDraftSavedAt(draft.savedAt);
      } catch {
        // プライベートモード等で保存できなくても入力は続けられる
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [
    serverLoaded,
    isConfirmed,
    dirty,
    values,
    tankPriceRaw,
    kirinTransport,
    kirinManagement,
    kirinTargets,
    copied,
    yearMonth,
  ]);

  function setValue(field: FieldKey, vehicleNo: string, raw: string) {
    setValues((prev) => ({ ...prev, [field]: { ...prev[field], [vehicleNo]: raw } }));
    // 人が触ったセルは、もう「先月の値のまま」ではない。
    setCopied((prev) => {
      const key = copiedKey(field, vehicleNo);
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    markDirty();
  }

  /**
   * 先月の値を、いま空欄のセルにだけ入れる。
   *
   * 入っている値を上書きしない(今月の請求書から写した数字を先月の値で潰さない)。
   * 入れたセルには印を付け、取り消せるようにし、確定前にもう一度数える (ux-design §5-3)。
   */
  function copyFromPreviousMonth(fields: readonly FieldDef[]) {
    const applied: FieldValues = emptyFieldValues();
    const newlyCopied = new Set(copied);
    let count = 0;
    for (const field of fields) {
      const source = previousMonthValues[field.key];
      if (!source) continue;
      for (const v of vehicles) {
        const prevValue = source[v.vehicleNo];
        if (prevValue === undefined || prevValue === 0) continue;
        if ((values[field.key][v.vehicleNo] ?? "").trim() !== "") continue;
        applied[field.key][v.vehicleNo] = String(prevValue);
        newlyCopied.add(copiedKey(field.key, v.vehicleNo));
        count += 1;
      }
    }
    if (count === 0) {
      setCopyResult("空欄のセルに入れられる先月の値がありませんでした");
      return;
    }
    setValues((prev) => {
      setPasteUndo(prev);
      const next: FieldValues = emptyFieldValues();
      for (const key of ALL_FIELD_KEYS) next[key] = { ...prev[key], ...applied[key] };
      return next;
    });
    setCopied(newlyCopied);
    setCopyResult(`空欄だった${count}件に先月の値を入れました。金額を見直してください`);
    markDirty();
  }

  /** そのステップで先月からコピーできる件数(空欄のセルだけ数える) */
  function copyableCount(fields: readonly FieldDef[]): number {
    let count = 0;
    for (const field of fields) {
      const source = previousMonthValues[field.key];
      if (!source) continue;
      for (const v of vehicles) {
        const prevValue = source[v.vehicleNo];
        if (prevValue === undefined || prevValue === 0) continue;
        if ((values[field.key][v.vehicleNo] ?? "").trim() !== "") continue;
        count += 1;
      }
    }
    return count;
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

  /**
   * 保存・確定の入口。
   *
   * 確定済みの月に保存すると、収支表を作り直す過程で確定が解除される。
   * いままでは何も出ないまま解除されていたので、ここで1回だけ確認を挟む
   * (ux-design §3 摩擦の非対称性。確認は1回まで、2回3回に増やさない)。
   */
  function requestPost(kind: "save" | "submit") {
    if (isConfirmed) {
      setPendingRelease(kind);
      return;
    }
    void post(kind === "save");
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
      // サーバに入った時点で下書きの役目は終わり。残すと次に開いたとき二重に復元される。
      clearDraft();
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
    // 戻した結果また空欄になったセルは「先月の値のまま」ではないので、印も消す。
    setCopied((prev) => {
      const next = new Set<string>();
      for (const key of prev) {
        const [field, vehicleNo] = key.split(":") as [FieldKey, string];
        if ((pasteUndo[field]?.[vehicleNo] ?? "").trim() !== "") next.add(key);
      }
      return next;
    });
    setPasteUndo(null);
    setPasteResult(copyResult ? "" : "貼り付けを取り消しました");
    setCopyResult(copyResult ? "先月の値を取り消しました" : "");
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
        <div className="max-h-[56vh] min-h-[14rem] overflow-auto" onPaste={handlePaste}>
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
                    className="btn btn-secondary pressable mt-4"
                  >
                    絞り込みを解除して全車両を表示
                  </button>
                </div>
              )}
            </div>
          ) : (
            <table className="data-table min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-subtle">
                <tr>
                  <th className="w-px px-3 py-2 text-left text-xs font-bold text-ink-muted">
                    車番
                  </th>
                  <th className="w-px px-3 py-2 text-left text-xs font-bold text-ink-muted">
                    運転者
                  </th>
                  {fields.map((f) => (
                    <th
                      key={f.key}
                      className="w-px px-3 py-2 text-right text-xs font-bold text-ink-muted"
                    >
                      {f.label}({f.unit})
                      {/* どの紙から写す欄かを、視線を動かさずに読める位置に常時置く */}
                      <span className="block text-[11px] font-normal">{f.source}</span>
                    </th>
                  ))}
                  {/*
                    余った幅はこの列が全部吸う。
                    以前は各列が画面幅いっぱいに引き伸ばされ、運転者名と入力欄の間が
                    数百px空いて、1行打つたびに視線が画面を横断していた。
                  */}
                  <th className="w-full" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map((v) => (
                  <tr key={v.vehicleNo} className="border-t border-line">
                    <td className="num px-3 py-2 whitespace-nowrap">
                      {/* 入力済みかどうかは色ではなく記号でも分かるようにする */}
                      <span aria-hidden className="mr-1 text-ink-muted">
                        {isEntered(v.vehicleNo) ? "✓" : "○"}
                      </span>
                      {v.vehicleNo}
                    </td>
                    {/* 長い運転者名でも折り返さない(行の高さが1行だけ変わると縦の並びが崩れる) */}
                    <td className="max-w-[10rem] truncate px-3 py-2 whitespace-nowrap">
                      {v.driver ?? "—"}
                    </td>
                    {fields.map((f, colIndex) => {
                      const raw = values[f.key][v.vehicleNo] ?? "";
                      const isCopied = copied.has(copiedKey(f.key, v.vehicleNo));
                      // 空欄のときだけ先月の値を出す。入力済みのセルに別の数字を並べても迷うだけ。
                      const prevValue =
                        raw.trim() === "" ? previousMonthValues[f.key]?.[v.vehicleNo] : undefined;
                      return (
                        <td key={f.key} className="px-3 py-2 text-right">
                          <NumberEntryField
                            value={raw}
                            onChange={(next) => setValue(f.key, v.vehicleNo, next)}
                            /*
                              空欄のまま確定したときに使われる金額を、欄の中に初期値として出す。
                              「空欄は自動計算されます」と説明する代わりに、いくらになるかを読ませる。
                              薄い文字のままなら誰も触っていない = 保存時も未入力(null)として送る。
                            */
                            autoValue={autoAmount(f.key, v.vehicleNo)}
                            ariaLabel={`${v.vehicleNo}番の${f.label}(${f.unit})`}
                            col={colIndex}
                            hints={
                              <>
                                {/* 先月の値のままであることを、色だけでなく文字でも出す */}
                                {isCopied ? (
                                  <span className="rounded bg-caution-soft px-1 text-[10px] font-semibold text-ink">
                                    先月の値
                                  </span>
                                ) : null}
                                {/* 空欄のセルには先月いくらだったかを出す(思い出させず、見て決められるように) */}
                                {prevValue !== undefined ? (
                                  <p className="num text-[11px] text-ink-muted">
                                    先月 {prevValue.toLocaleString("ja-JP")}
                                  </p>
                                ) : null}
                              </>
                            }
                          />
                        </td>
                      );
                    })}
                    <td aria-hidden />
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
          {/*
            自動計算の金額は欄の中に薄い文字で入っている。触らなければその金額で確定する。
            どの欄でも同じ作法にしたので、説明は表の下に1行だけ置く。
          */}
          {fields.some((f) => f.keepsBlank) ? (
            <p>
              薄い文字に「自動」と付いている欄は、システムが計算した金額です。そのままでよければ
              触らずに進めます。手で直すと文字が濃くなり、「自動に戻す」で元に戻せます。
            </p>
          ) : null}
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
        {/*
          先月の値をまとめて入れる。空欄のセルにしか入らないので、押し間違えても
          いま入力した数字は消えない。入れた件数を必ず言い、取り消せる状態にしておく。
        */}
        {copyableCount(stepFields) > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => copyFromPreviousMonth(stepFields)}
              className="btn btn-quiet btn-sm pressable"
            >
              空欄に先月({previousYearMonth})の値を入れる
              <span className="num ml-1">{copyableCount(stepFields)}件</span>
            </button>
            <span className="text-[11px] text-ink-muted">
              入れた欄には「先月の値」と印が付きます。金額は必ず見直してください
            </span>
          </div>
        ) : null}
        {copyResult ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-caution-border bg-caution-soft px-3 py-2 text-xs text-ink">
            <span>{copyResult}</span>
            {pasteUndo ? (
              <button
                type="button"
                onClick={undoPaste}
                className="btn btn-secondary pressable"
              >
                元に戻す
              </button>
            ) : null}
          </div>
        ) : null}
        {pasteResult ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-subtle px-3 py-2 text-xs text-ink">
            <span>{pasteResult}</span>
            {pasteUndo ? (
              <button
                type="button"
                onClick={undoPaste}
                className="btn btn-secondary pressable"
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
        if (isLast) requestPost("submit");
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
      <StickyStepHeader
        steps={STEPS.map((s) => ({
          label: s.label,
          /*
            番号は業務フロー docx の STEP 番号に揃える。画面独自の通し番号を併記すると
            「STEP5 なのに 4番目」のように2つの番号が食い違い、現在地が分からなくなる。
          */
          badge: s.workflowId ?? "最後",
        }))}
        currentIndex={step}
        onSelect={(i) => {
          setStep(i);
          setVehicleSearch("");
          setEntryFilter("all");
          setPasteResult("");
        }}
        trailing={yearMonth}
      />

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
              className="btn btn-primary pressable mt-3 inline-block"
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

      {/*
        確定済みの月であることは、保存を押す前に見えている必要がある。
        いままでは保存すると黙って確定が解除されていた (残課題10)。
      */}
      {isConfirmed ? (
        <div className="rounded-md border border-caution-border bg-caution-soft px-4 py-3">
          <p className="text-sm font-bold text-ink">この月は確定済みです</p>
          <p className="mt-1 text-xs leading-relaxed text-ink">
            ここで保存すると収支表を作り直すため、確定が解除されます。直したあとに、
            もう一度収支表の画面で確定し直してください。入力途中の下書きも、この月では保存しません。
          </p>
        </div>
      ) : null}

      {/*
        下書きの復元は黙ってやらない。いつ時点の下書きかを出し、破棄できるようにする (ux-design §4-1)。
      */}
      {draftRestoredAt !== null ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-subtle px-4 py-2 text-xs text-ink">
          <span>
            <span className="num">{draftStamp(draftRestoredAt)}</span>{" "}
            時点の入力途中(まだ保存していないもの)を読み込みました。
          </span>
          <button
            type="button"
            onClick={discardDraft}
            className="btn btn-secondary pressable"
          >
            下書きを破棄して保存済みの状態に戻す
          </button>
        </div>
      ) : null}

      <section className="rise-in rounded-xl border border-line bg-white p-5">
        {step === 0 ? (
          <div>
            <h2 className="text-sm font-bold text-ink">キリンの輸送協力金・経営支援金</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {/* 他のステップの欄と同じ部品・同じ作法にする(この2つに自動計算の値は無い) */}
              <div className="flex flex-col gap-1 text-xs text-ink">
                輸送協力金(円)
                <NumberEntryField
                  value={kirinTransport}
                  onChange={(next) => {
                    setKirinTransport(next);
                    markDirty();
                  }}
                  ariaLabel="輸送協力金(円)"
                  widthClass="w-44"
                />
              </div>
              <div className="flex flex-col gap-1 text-xs text-ink">
                経営支援金(円)
                <NumberEntryField
                  value={kirinManagement}
                  onChange={(next) => {
                    setKirinManagement(next);
                    markDirty();
                  }}
                  ariaLabel="経営支援金(円)"
                  widthClass="w-44"
                />
              </div>
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
              {/*
                表の欄と同じ部品にする。先月の単価は「自動で入っている値」として
                薄い文字で欄の中に出し、手で直せば濃い文字に変わる。
              */}
              <div className="flex flex-col gap-1 text-xs text-ink">
                インタンク単価(円/ℓ)
                <NumberEntryField
                  value={tankPriceRaw}
                  onChange={(next) => {
                    setTankPriceRaw(next);
                    markDirty();
                  }}
                  autoValue={carriedTankPrice}
                  autoLabel={`先月(${previousYearMonth})の単価`}
                  ariaLabel="インタンク単価(円/ℓ)"
                  widthClass="w-40"
                />
                <span className="text-[11px] text-ink-muted">
                  給油量 × この単価 で全車の軽油代を計算します
                </span>
              </div>
              {/*
                単価は月ごとに設定する値で、初期値が入っていない。
                0のまま進むと給油量を全部入力しても軽油代が全車0円になり、
                しかも数量は入っているので異常値チェックにも掛からない。
                ここで気づけるようにし、前月の単価をワンタップで引き継げるようにする。
              */}
              {tankPriceCarried ? (
                <div className="mt-2 rounded-md border border-caution-border bg-caution-soft px-3 py-2">
                  <p className="text-xs font-bold text-ink">
                    先月({previousYearMonth})の単価をそのまま入れています
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink">
                    今月まだ単価を決めていないため、先月の
                    <span className="num">{prevTankPricePerLiter.toLocaleString("ja-JP")}</span>
                    円/ℓ を入れた状態にしています。今月の仕入単価を確認してください。
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      // 「確認した」= 今月の単価として本人が決めた、なので人が入れた値に変える
                      setTankPriceRaw(String(prevTankPricePerLiter));
                      markDirty();
                    }}
                    className="btn btn-secondary btn-sm pressable mt-2"
                  >
                    確認しました(先月と同じでよい)
                  </button>
                </div>
              ) : null}
              {tankPrice === 0 ? (
                <div className="mt-2 rounded-md border border-caution-border bg-caution-soft px-3 py-2">
                  <p className="text-xs font-bold text-ink">
                    単価が0のままだと、全車の軽油代が0円になります
                  </p>
                  <p className="mt-1 text-xs text-ink">
                    {prevTankPricePerLiter > 0
                      ? `先月(${previousYearMonth})は ${prevTankPricePerLiter.toLocaleString("ja-JP")} 円/ℓ でした。今月の仕入単価を入力してください。`
                      : "先月の単価が記録されていないため、今月の仕入単価を入力してください。"}
                  </p>
                </div>
              ) : null}
              {/*
                B-2: いまの計算がどちらの前提で動いているかを、その場に書いておく。
                業務側への確認 (docs/product/業務確認事項.md 質問1) の回答が来るまでは
                この前提のままなので、暗黙にせず画面に出す。
              */}
              <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
                いまの計算: 燃料の量は「インタンク給油量 + 外部給油量」で足しています。
                デジタコの総給油量は取り込んでいますが、この計算には使っていません。
              </p>
            </div>
            {renderToolbar()}
            {renderFieldTable(FUEL_FIELDS)}
          </div>
        ) : null}

        {step === 2 ? (
          <PayrollStep
            yearMonth={yearMonth}
            payrollStatus={payrollStatus}
            rows={payrollDetail}
            summary={payrollSummary}
            canManageMasters={canManageVehicleMaster}
          />
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
              確定の直前に、人がまだ見ていない数字をもう一度数える。
              先月の値・0円扱いの空欄は、どちらも「入力した数字」と同じ見た目で表に並ぶので、
              ここで数え直さないと確認されないまま締まる。
            */}
            {tankPriceCarried || copied.size > 0 || unenteredRepairCount > 0 ? (
              <div className="mt-4 rounded-md border border-caution-border bg-caution-soft px-4 py-3">
                <p className="text-sm font-bold text-ink">確定の前に見ておいてほしいもの</p>
                <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed text-ink">
                  {tankPriceCarried ? (
                    <li>
                      インタンク単価が先月({previousYearMonth})のままです(
                      <span className="num">{tankPrice.toLocaleString("ja-JP")}</span>円/ℓ)。
                      今月の仕入単価で合っているか確認してください。
                    </li>
                  ) : null}
                  {copied.size > 0 ? (
                    <li>
                      先月の値を入れたまま見直していない欄が{" "}
                      <span className="num">{copied.size}</span>件 あります(欄に「先月の値」と出ています)。
                    </li>
                  ) : null}
                  {unenteredRepairCount > 0 ? (
                    <li>
                      修繕費が未入力の車両が <span className="num">{unenteredRepairCount}</span>台
                      あります。<strong>0円として確定します。</strong>
                      請求書が無い(修繕なし)ならそのままで問題ありません。
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {/*
              B-2: 入力欄を持たない項目があることを、確定の画面に正直に出す
              (docs/product/業務確認事項.md 質問3 の回答待ち)。
            */}
            <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
              「その他諸経費」「備品費」「メンテ費」には入力欄がありません。前に入っていた値を
              そのまま持ち越して収支表に載せます(この画面では増減しません)。
            </p>
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
                  className="btn btn-primary pressable mt-3 inline-block"
                >
                  次へ: 収支表のチェックに進む
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        {/*
          確定済みの月に保存しようとしたとき。何が起きるかを書いてから1回だけ確認する。
          押した時点では何もしていないので、「やめる」でそのまま入力に戻れる。
        */}
        {pendingRelease !== null ? (
          <div className="mt-4 rounded-md border border-caution-border bg-caution-soft px-4 py-3">
            <p className="text-sm font-bold text-ink">確定を解除して保存しますか?</p>
            <p className="mt-1 text-xs leading-relaxed text-ink">
              この月は確定済みです。保存すると収支表を作り直すため、確定は解除されます。
              直したあとに、収支表の画面でもう一度確定してください。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const kind = pendingRelease;
                  setPendingRelease(null);
                  void post(kind === "save");
                }}
                className="btn btn-primary pressable"
              >
                確定を解除して{pendingRelease === "save" ? "保存する" : "収支表を作り直す"}
              </button>
              <button
                type="button"
                onClick={() => setPendingRelease(null)}
                className="btn btn-quiet pressable"
              >
                やめる
              </button>
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-3 rounded-md border border-caution-border bg-caution-soft px-4 py-3 text-xs">
            {errorMessage}
          </div>
        ) : null}
      </section>

      {/*
        「戻る」「ここまでを保存」「次へ」は画面の下に貼り付けておく。
        車両が何十台も並ぶ表を下まで見ていくと、以前は操作列が画面の外に出てしまい、
        保存できることに気づかないまま閉じられていた。
      */}
      <StickyActionBar>
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="btn btn-quiet pressable"
        >
          戻る
        </button>

        {/* 請求書が全部揃う前に閉じても入力が消えないようにする。どのステップからでも押せる。 */}
        <button
          type="button"
          disabled={saveState === "pending" || !hasVehicles}
          onClick={() => requestPost("save")}
          className="btn btn-secondary pressable"
        >
          {saveState === "pending" ? "保存しています…" : "ここまでを保存"}
        </button>
        {/* 保存の状態を常に正直に出す。「保存しました」を出したまま編集を続けさせない。 */}
        {saveState === "done" && !dirty ? (
          <span className="text-xs text-ink-muted">保存しました</span>
        ) : null}
        {dirty ? (
          <span className="text-xs font-semibold text-ink">
            保存していない入力があります
            {/* 下書きに退避してあることを添える。「消えるかもしれない」と思わせない */}
            {draftSavedAt !== null ? (
              <span className="num ml-1 font-normal text-ink-muted">
                (下書きは {draftStamp(draftSavedAt)} に自動保存)
              </span>
            ) : null}
          </span>
        ) : null}

        <div className="ml-auto">
          {isLast ? (
            <button
              type="submit"
              disabled={submitState === "pending" || !hasVehicles}
              className="btn btn-primary pressable"
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
              className="btn btn-primary pressable"
            >
              次へ
            </button>
          )}
        </div>
      </StickyActionBar>
    </form>
  );
}
