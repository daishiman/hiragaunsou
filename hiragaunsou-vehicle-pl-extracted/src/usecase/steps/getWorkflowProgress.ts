import {
  WORKFLOW_STEPS,
  type WorkflowStepDefinition,
  type WorkflowStepId,
} from "../../domain/rules/workflowSteps";
import type { ImportBatchRepository, ReviewFlagRepository, VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { ManualInputRepository, ManualInputRecord } from "../../domain/repositories/ManualInputRepository";
import type { CleansingDecisionRepository } from "../../domain/repositories/CleansingDecisionRepository";
import { CLEANSING_SOURCE_TYPE } from "./getCleansingQueue";

/**
 * 業務フロー(docx 8ステップ)の進捗を判定するユースケース。
 *
 * 「いまどこまで終わっていて、次に何をすればいいか」を1つの出典から出すことで、
 * 画面ごとに違う進捗が出る(ユーザーが現在地を見失う)ことを防ぐ。
 *
 * 判定は必ず実データから行い、推測で「済」にしない。
 * 済んでいないことを正直に出すほうが、間違ったまま締めるより安い。
 */

export type WorkflowStepStatus =
  /** まだ手を付けていない */
  | "todo"
  /** 一部だけ入っている (入力途中) */
  | "partial"
  /** 完了 */
  | "done";

export interface WorkflowStepProgress {
  step: WorkflowStepDefinition;
  status: WorkflowStepStatus;
  /** 「43台中12台入力済み」のような、進み具合を表す1行 */
  detail: string;
  /** 前の必須ステップが終わっていないため、まだ着手できない */
  blocked: boolean;
  /**
   * いま押したときに実際に続きができる画面。
   *
   * ステップ定義の href は「そのステップの入口」であり、途中まで進んだ状態では行き先が変わる。
   * 例: STEP2は取込・整形・キリン配賦の3つを含むため、取込が済んだあとに /import へ送ると
   * 「取込済み」の画面に戻されて次に何をすればよいか分からなくなる。
   */
  href: string;
  /** その画面で何をすることになるか。href が入口と違うときだけ入る */
  actionLabel: string | null;
}

export interface WorkflowProgressResult {
  yearMonth: string;
  steps: WorkflowStepProgress[];
  /** 次にやるべきステップ (全部終わっていれば null) */
  nextStep: WorkflowStepProgress | null;
  doneCount: number;
  totalCount: number;
  /** 8ステップすべて完了 */
  isComplete: boolean;
}

/** その車両にSTEP3(燃料費)の入力があるか */
function hasFuelInput(r: ManualInputRecord): boolean {
  return r.fuelInQty > 0 || r.fuelOut > 0 || r.fuelOutQty > 0 || r.adblue > 0;
}

/**
 * その車両にSTEP5(修繕費・タイヤ)の入力があるか。
 * 備品費・メンテ費は業務フローに対応する手順が無く手入力画面から外したため、
 * 過去に入った値が残っているだけで「入力済み」と数えないよう判定から除く。
 */
function hasExpenseInput(r: ManualInputRecord): boolean {
  return r.repairActual > 0 || (r.tireActual ?? 0) > 0;
}

/** その車両にSTEP6(高速料金)の入力があるか */
function hasTollInput(r: ManualInputRecord): boolean {
  return r.tollActual !== null || r.tollDiscountActual !== null;
}

function entryStatus(entered: number, total: number): WorkflowStepStatus {
  if (total === 0 || entered === 0) return "todo";
  return entered >= total ? "done" : "partial";
}

export class GetWorkflowProgressUseCase {
  constructor(
    private readonly importBatchRepo: ImportBatchRepository,
    private readonly manualInputRepo: ManualInputRepository,
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly reviewFlagRepo: ReviewFlagRepository,
    private readonly cleansingDecisionRepo: CleansingDecisionRepository,
    /**
     * キリンの協力金は rate_master に保存される。
     * 以前は manual_vehicle_input の miscOther を見ていたが、手入力画面はこの列に書かないため
     * 入力しても STEP2 が永久に「未完了」のままだった。金額の保存先そのものを見る。
     */
    private readonly kirinAmountLoader?: (yearMonth: string) => Promise<number>,
  ) {}

  async execute(yearMonth: string): Promise<WorkflowProgressResult> {
    const [
      opBatch,
      salesBatch,
      payrollBatch,
      manualInputs,
      vehicleCount,
      openFlags,
      cleansingFlagged,
      cleansingDecided,
      confirmation,
      kirinAmount,
    ] = await Promise.all([
      this.importBatchRepo.findLatestBatch(yearMonth, "vehicle_operation"),
      this.importBatchRepo.findLatestBatch(yearMonth, "sales_monitor"),
      this.importBatchRepo.findLatestBatch(yearMonth, "payroll"),
      this.manualInputRepo.findByYearMonth(yearMonth),
      this.vehiclePlRepo.countByYearMonth(yearMonth),
      this.reviewFlagRepo.findOpenByYearMonth(yearMonth),
      this.importBatchRepo.countRawRowsWithFlags(yearMonth, CLEANSING_SOURCE_TYPE),
      this.cleansingDecisionRepo.countByYearMonth(yearMonth, CLEANSING_SOURCE_TYPE),
      this.vehiclePlRepo.getConfirmation(yearMonth),
      this.kirinAmountLoader ? this.kirinAmountLoader(yearMonth) : Promise.resolve(0),
    ]);

    // STEP2は「取込」だけでなく「傭車・2重計上・諸口の整理」「キリン配賦」まで終えて完了。
    // 判断が残っているうちは done にしない (整理前の数字で締めさせないため)。
    const cleansingPending = Math.max(0, cleansingFlagged - cleansingDecided);

    // 入力の分母は「収支表に載っている車両数」。まだ0台なら分母が立たないので手入力系はtodo扱い。
    const total = vehicleCount;
    const fuelEntered = manualInputs.filter(hasFuelInput).length;
    const expenseEntered = manualInputs.filter(hasExpenseInput).length;
    const tollEntered = manualInputs.filter(hasTollInput).length;
    const kirinEntered = kirinAmount > 0 || manualInputs.some((r) => r.miscOther > 0);
    const isMonthConfirmed = confirmation.total > 0 && confirmation.confirmed >= confirmation.total;

    // 取込(STEP1・2)が済むまで手入力系(STEP3・5・6)とチェック(7・8)は着手できない
    const importsDone = opBatch !== null && salesBatch !== null;

    /**
     * 収支表が0台のときの理由。「取込がまだ」と「取り込んだが車両マスタに1台も居ない」は
     * 対処が全く違う。取込を終えた人に「先に取込が必要です」と出すと、何をしても進まない画面に
     * 見えるため、必ず分けて伝える。
     */
    const emptyReason = importsDone
      ? "運行実績・売上は取込済みですが、収支表に載る車両が0台です。車両マスタに車両が登録されているか確認してください"
      : "先に運行実績・売上の取込が必要です";

    const statusById: Record<WorkflowStepId, { status: WorkflowStepStatus; detail: string }> = {
      1: opBatch
        ? { status: "done", detail: `${opBatch.fileName} を取込済み (${opBatch.rowCount}行)` }
        : { status: "todo", detail: "車両別運行実績表のCSVがまだ取り込まれていません" },
      2: !salesBatch
        ? { status: "todo", detail: "売上モニタリストのCSVがまだ取り込まれていません" }
        : cleansingPending > 0
          ? {
              status: "partial",
              detail: `${salesBatch.fileName} を取込済み。傭車・2重計上・諸口の確認が ${cleansingPending}件 残っています`,
            }
          : {
              status: kirinEntered ? "done" : "partial",
              detail: kirinEntered
                ? `${salesBatch.fileName} を取込済み・要確認 ${cleansingFlagged}件 も判定済み・キリン配賦も入力済み`
                : `${salesBatch.fileName} を取込済み。キリンの協力金の配賦がまだです`,
            },
      3: {
        status: entryStatus(fuelEntered, total),
        detail:
          total === 0
            ? emptyReason
            : `${total}台中 ${fuelEntered}台 入力済み`,
      },
      4: payrollBatch
        ? { status: "done", detail: `${payrollBatch.fileName} を取込済み (${payrollBatch.rowCount}行)` }
        : { status: "todo", detail: "給与集計表のCSVがまだ取り込まれていません" },
      5: {
        status: entryStatus(expenseEntered, total),
        detail:
          total === 0
            ? emptyReason
            : `${total}台中 ${expenseEntered}台 入力済み`,
      },
      6: {
        status: entryStatus(tollEntered, total),
        detail:
          total === 0
            ? emptyReason
            : `${total}台中 ${tollEntered}台 入力済み(未入力分は組合割引率で計算)`,
      },
      7:
        total === 0
          ? { status: "todo", detail: "まだ収支表が作られていません" }
          : openFlags.length > 0
            ? { status: "partial", detail: `未判定の異常値が ${openFlags.length}件 あります` }
            : { status: "done", detail: "未判定の異常値はありません" },
      // STEP8は「確定操作をしたか」で判定する。STEP7が済んだだけでは done にしない
      // (Excelへの転記に代わる締めの意思表示を、人が明示的に1回行う)
      8: isMonthConfirmed
        ? { status: "done", detail: `${total}台分の収支表を確定済みです。CSVで書き出せます` }
        : total === 0
          ? { status: "todo", detail: "まだ収支表が作られていません" }
          : openFlags.length > 0
            ? { status: "todo", detail: "STEP7のチェックが終わると締められます" }
            : { status: "todo", detail: "月次収支表を確認して「この月を確定する」を押してください" },
    };

    /**
     * STEP2は「取込 → 傭車・2重計上・諸口の整理 → キリンの協力金の配賦」の3つを含む。
     * どこまで進んだかで続きの画面が変わるため、入口の href をそのまま返さない。
     */
    const step2Next: { href: string; actionLabel: string } | null = !salesBatch
      ? null
      : cleansingPending > 0
        ? { href: "/cleansing", actionLabel: "傭車・2重計上・諸口を判定する" }
        : !kirinEntered
          ? { href: "/manual-entry?step=2", actionLabel: "キリンの協力金を入力する" }
          : null;

    const steps: WorkflowStepProgress[] = WORKFLOW_STEPS.map((step) => {
      const s = statusById[step.id];
      const blocked = !importsDone && step.id >= 3;
      const next = step.id === 2 ? step2Next : null;
      return {
        step,
        status: s.status,
        detail: s.detail,
        blocked,
        href: next?.href ?? step.href,
        actionLabel: next?.actionLabel ?? null,
      };
    });

    const nextStep = steps.find((s) => !s.blocked && s.status !== "done") ?? null;
    const doneCount = steps.filter((s) => s.status === "done").length;

    return {
      yearMonth,
      steps,
      nextStep,
      doneCount,
      totalCount: steps.length,
      isComplete: doneCount === steps.length,
    };
  }
}
