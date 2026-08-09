/**
 * マスタ(率・車両・運転者)を直したときに、どの月へ反映し、どの月を据え置くかの判定と、
 * 据え置いた月がいまのマスタとどう食い違っているかの突き合わせ。
 *
 * 方針(依頼者決定): **まだ締めていない月は自動で反映し、確定済みの月は据え置く**。
 * 確定済みの月の数字が本人の知らないうちに変わると、配布済みの収支表と手元の表が
 * 食い違ったまま気づけない。据え置いたうえで「ここが違います」と見せ、反映するかどうかを
 * 人が選ぶ。
 *
 * Domain層: フレームワーク非依存。D1・fetch等の外部依存を import しない。
 * 表示用の日本語ラベルもここには置かない (Presentation層の app/_lib/fieldLabels.ts が持つ)。
 */

import type { VehiclePlCalculated } from "./vehiclePlCalculation";

/** 月ごとの確定状況。vehicle_pl の行数と、そのうち確定済みの行数。 */
export interface MonthConfirmationState {
  yearMonth: string;
  /** その月の収支表の行数 */
  total: number;
  /** そのうち確定済みの行数 */
  confirmed: number;
}

/**
 * その月が「確定済み(締めた)」か。
 *
 * 行が1件も無い月は締めようがないので確定済みではない。
 * 全行が確定していて初めて確定済みとする (ConfirmMonthlyPlUseCase.status と同じ判定)。
 * 一部の行だけ確定が外れている月は「まだ締めていない」側に倒す。中途半端な状態のまま
 * 据え置くと、いつまでも食い違いが解消されない月が残るため。
 */
export function isMonthClosed(month: MonthConfirmationState): boolean {
  return month.total > 0 && month.confirmed >= month.total;
}

export interface ApplyTargets {
  /** すぐ作り直してよい月 (まだ締めていない) */
  autoApply: string[];
  /** 据え置く月 (確定済み)。あとで食い違いとして見せる */
  heldBack: string[];
}

/**
 * マスタを1件直したあと、どの月を作り直すかを決める。
 *
 * onlyYearMonth は「その月にしか効かない直し」のときに渡す (率マスタの月別値など)。
 * 渡さなければ全期間に効く直しとして、収支表がある月すべてを対象にする。
 * 収支表が1行も無い月は作り直しても書くものが無いので、最初から外す。
 */
export function selectApplyTargets(
  months: readonly MonthConfirmationState[],
  onlyYearMonth?: string | null,
): ApplyTargets {
  const autoApply: string[] = [];
  const heldBack: string[] = [];

  for (const month of months) {
    if (month.total <= 0) continue;
    if (onlyYearMonth != null && month.yearMonth !== onlyYearMonth) continue;
    if (isMonthClosed(month)) heldBack.push(month.yearMonth);
    else autoApply.push(month.yearMonth);
  }

  autoApply.sort();
  heldBack.sort();
  return { autoApply, heldBack };
}

/**
 * 突き合わせから外す列。
 *
 * no は行を結びつけるキーそのもの。towedVehicleNos は車番ラベルの組み立て専用で
 * 計算に使われない (vehiclePlCalculation.ts の定義コメント参照)。
 */
const IGNORED_FIELDS = new Set<string>(["no", "towedVehicleNos"]);

/**
 * 画面に1行として出す列 (マスタを直すと直接動く値)。
 *
 * 小計や費用計はここに入れない。リース費を1つ直しただけで
 * 「リース費・運送費計・固定費・経費計」の4行が出ると、何が起きたのか読み取れなくなる。
 * 小計側の差は拾いはする(下の diff は全列を見る)が、画面では畳んでおく。
 */
const PRIMARY_FIELDS = new Set<string>([
  // 運転者マスタ由来
  "driver",
  "code",
  "salary",
  "welfare",
  "bonus",
  // 車両マスタ由来
  "type",
  "depot",
  "reg",
  "insCompulsory",
  "insVoluntary",
  "taxAuto",
  "taxWeight",
  "lease",
  "installment",
  // 車両マスタの原価区分由来 (km×単価の標準原価)
  "tire",
  "repairStandard",
  // 率マスタ由来
  "adminFee",
  "tollDisc",
  "fuelIn",
]);

/**
 * 同じ値とみなす幅。
 *
 * 金額は round2 済みなので 0.005 で足りる。利益率(margin)と燃費(nempi)は
 * 比率・小数なので、同じ幅で見ると常に「違う」と言い張ることになる。
 */
function epsilonFor(field: string): number {
  return field === "margin" || field === "nempi" ? 1e-9 : 0.005;
}

function isSameValue(field: string, before: unknown, after: unknown): boolean {
  if (typeof before === "number" && typeof after === "number") {
    return Math.abs(before - after) <= epsilonFor(field);
  }
  // null と空文字は「入っていない」で同じ扱い。運転者名の未設定が
  // 保存経路によって null になったり "" になったりするため。
  const b = before === null || before === undefined ? "" : String(before);
  const a = after === null || after === undefined ? "" : String(after);
  return b === a;
}

export interface FieldChange {
  field: string;
  before: number | string | null;
  after: number | string | null;
  /** 画面に1行として出すか (小計・派生値は false) */
  primary: boolean;
}

export interface VehiclePlRowDiff {
  vehicleNo: string;
  /** 運転者名 (誰の車かを人が見分けるため。取れなければ null) */
  driver: string | null;
  /** changed: 値が違う / added: いまのマスタなら増える車 / removed: いまのマスタなら消える車 */
  kind: "changed" | "added" | "removed";
  changes: FieldChange[];
  profitBefore: number | null;
  profitAfter: number | null;
  /** 損益の増減 (後 - 前)。増えた車は前を0、消える車は後を0として数える */
  profitDelta: number;
}

/**
 * 保存されている収支表(stored)と、いまのマスタで作り直したらこうなる表(recomputed)を
 * 車番で突き合わせる。
 *
 * 収支表は毎回まるごと作り直される作りなので、保存済みの行がそのまま
 * 「そのとき使ったマスタ値」のスナップショットになっている。別途スナップショットを
 * 持たなくても、作り直した結果と比べるだけで食い違いが出せる。
 */
export function diffVehiclePlRows(
  stored: readonly VehiclePlCalculated[],
  recomputed: readonly VehiclePlCalculated[],
): VehiclePlRowDiff[] {
  const storedByNo = new Map(stored.map((r) => [r.no, r]));
  const recomputedByNo = new Map(recomputed.map((r) => [r.no, r]));
  const diffs: VehiclePlRowDiff[] = [];

  for (const [no, after] of recomputedByNo) {
    const before = storedByNo.get(no);
    if (!before) {
      diffs.push({
        vehicleNo: no,
        driver: after.driver ?? null,
        kind: "added",
        changes: [],
        profitBefore: null,
        profitAfter: after.profit,
        profitDelta: after.profit,
      });
      continue;
    }

    const changes: FieldChange[] = [];
    for (const field of Object.keys(after) as (keyof VehiclePlCalculated)[]) {
      if (IGNORED_FIELDS.has(field)) continue;
      const b = before[field] as number | string | null | undefined;
      const a = after[field] as number | string | null | undefined;
      if (isSameValue(field, b, a)) continue;
      changes.push({
        field,
        before: (b ?? null) as number | string | null,
        after: (a ?? null) as number | string | null,
        primary: PRIMARY_FIELDS.has(field),
      });
    }
    if (changes.length === 0) continue;

    diffs.push({
      vehicleNo: no,
      driver: after.driver ?? before.driver ?? null,
      kind: "changed",
      changes,
      profitBefore: before.profit,
      profitAfter: after.profit,
      profitDelta: after.profit - before.profit,
    });
  }

  for (const [no, before] of storedByNo) {
    if (recomputedByNo.has(no)) continue;
    diffs.push({
      vehicleNo: no,
      driver: before.driver ?? null,
      kind: "removed",
      changes: [],
      profitBefore: before.profit,
      profitAfter: null,
      profitDelta: -before.profit,
    });
  }

  // 損益への影響が大きい車から見せる。同額なら車番順で並びを安定させる。
  diffs.sort((x, y) => {
    const d = Math.abs(y.profitDelta) - Math.abs(x.profitDelta);
    return d !== 0 ? d : x.vehicleNo.localeCompare(y.vehicleNo, "ja");
  });
  return diffs;
}

export interface MonthDiffSummary {
  yearMonth: string;
  /** 数字が変わる車の台数 */
  vehicleCount: number;
  /** その月の損益合計がいくら動くか (後 - 前) */
  profitDelta: number;
  /** いまのマスタなら増える車の台数 */
  addedCount: number;
  /** いまのマスタなら消える車の台数 */
  removedCount: number;
}

export function summarizeMonthDiff(
  yearMonth: string,
  diffs: readonly VehiclePlRowDiff[],
): MonthDiffSummary {
  return {
    yearMonth,
    vehicleCount: diffs.length,
    profitDelta: diffs.reduce((sum, d) => sum + d.profitDelta, 0),
    addedCount: diffs.filter((d) => d.kind === "added").length,
    removedCount: diffs.filter((d) => d.kind === "removed").length,
  };
}

/** 直した対象の種類。履歴の見出しを組み立てるときに使う */
export type MasterEditTargetKind = "rate" | "vehicle" | "driver";

/**
 * 直しの履歴1件。値は数値も文字列も入るので文字列で持つ
 * (率・金額・運転者名・車番が同じ表に並ぶため、型を分けると読む側が2倍になる)。
 */
export interface MasterEditRecord {
  id: string;
  targetKind: MasterEditTargetKind;
  /** 直した対象を一意に指す文字列 (率: キー|年月 / 車両: 車番 / 運転者: 社員コード) */
  targetKey: string;
  /** 画面に出す対象名 (「129番」「田中(社員No 12)」「一般管理費率」) */
  targetLabel: string;
  field: string;
  fieldLabel: string;
  beforeValue: string | null;
  afterValue: string | null;
  editedByName: string;
  editedAt: number;
  undoneAt: number | null;
}
