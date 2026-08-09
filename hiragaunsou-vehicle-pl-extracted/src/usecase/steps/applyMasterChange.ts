import {
  diffVehiclePlRows,
  isMonthClosed,
  selectApplyTargets,
  summarizeMonthDiff,
  type MasterEditRecord,
  type MasterEditTargetKind,
  type MonthConfirmationState,
  type MonthDiffSummary,
  type VehiclePlRowDiff,
} from "../../domain/rules/masterChangeImpact";
import type { VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";
import type { MonthlyPlPreviewer } from "./previewMonthlyPl";

/**
 * マスタを直したときの反映と、据え置いた月の食い違いの取り扱い。
 *
 * 依頼者の決定:
 *   - まだ締めていない月  → 直した内容をそのまま反映する (自動)
 *   - 確定済みの月        → 据え置く。数字は勝手に変えない
 *   - 据え置いて食い違った月は一覧で見せ、反映するかどうかを人が選ぶ
 *   - 反映したら誰がいつ反映したかを残し、元に戻せるようにする
 *
 * これまでは率マスタを1件保存しただけで、確定済みかどうかに関わらず対象月が
 * 作り直されていた。作り直すと確定も黙って外れる (upsertMany が confirmed を0に戻す) ため、
 * 締めたはずの月が締まっていない状態に戻り、配布済みの収支表と数字が食い違っていた。
 */

/** 収支表を本当に作り直すもの (RecalculateMonthlyPlUseCase)。 */
export interface MonthlyPlRebuilder {
  execute(input: { yearMonth: string }): Promise<{ vehicleCount: number }>;
}

/** 直しの履歴1件の入力。値は文字列で受ける (率・金額・名前が同じ表に並ぶため)。 */
export interface MasterEditInput {
  targetKind: MasterEditTargetKind;
  targetKey: string;
  targetLabel: string;
  field: string;
  fieldLabel: string;
  beforeValue: string | null;
  afterValue: string | null;
}

/** 確定済み月への反映の記録1件。 */
export interface ConfirmedMonthApplyRecord {
  id: string;
  yearMonth: string;
  summary: string;
  appliedByName: string;
  appliedAt: number;
  revertedAt: number | null;
}

/** 履歴と記録の保存先。 */
export interface MasterChangeHistoryRepository {
  /** 収支表がある月の一覧と、その確定状況 */
  listMonthlyConfirmations(): Promise<MonthConfirmationState[]>;
  recordEdits(
    edits: readonly MasterEditInput[],
    actor: { id: string | null; name: string },
  ): Promise<void>;
  listEdits(limit: number): Promise<MasterEditRecord[]>;
  findEdit(id: string): Promise<MasterEditRecord | null>;
  markEditUndone(id: string, actorId: string | null): Promise<void>;
  recordApply(input: {
    yearMonth: string;
    summary: string;
    snapshot: readonly VehiclePlCalculated[];
    actor: { id: string | null; name: string };
  }): Promise<string>;
  listApplies(limit: number): Promise<ConfirmedMonthApplyRecord[]>;
  findApplySnapshot(
    id: string,
  ): Promise<{ yearMonth: string; snapshot: VehiclePlCalculated[]; revertedAt: number | null } | null>;
  markApplyReverted(id: string, actorId: string | null): Promise<void>;
}

export interface ApplyMasterChangeResult {
  /** 実際に作り直した月 */
  appliedYearMonths: string[];
  /** 作り直した月と、その月で作り直した台数 (画面の「○台を再計算しました」に使う) */
  applied: { yearMonth: string; vehicleCount: number }[];
  /** 据え置いた月 (確定済み) */
  heldBackYearMonths: string[];
}

/**
 * マスタを1件直したあとに呼ぶ。まだ締めていない月だけを作り直す。
 *
 * onlyYearMonth は「その月にしか効かない直し」に渡す (率マスタの月別値)。
 * 全期間に効く直し (共通の率・車両マスタ・運転者マスタ) では渡さないこと。
 * 渡してしまうと、他の未確定月が古いマスタのまま置き去りになる。
 */
export class ApplyMasterChangeUseCase {
  constructor(
    private readonly historyRepo: MasterChangeHistoryRepository,
    private readonly rebuilder: MonthlyPlRebuilder,
  ) {}

  async execute(input: {
    edits: readonly MasterEditInput[];
    actor: { id: string | null; name: string };
    onlyYearMonth?: string | null;
  }): Promise<ApplyMasterChangeResult> {
    if (input.edits.length > 0) {
      await this.historyRepo.recordEdits(input.edits, input.actor);
    }

    const months = await this.historyRepo.listMonthlyConfirmations();
    const { autoApply, heldBack } = selectApplyTargets(months, input.onlyYearMonth ?? null);

    // 月をまたいで並列に作り直すと、同じ D1 に対する書き込みが重なる。
    // 月数は多くても年度1本ぶんなので、素直に順番に流す。
    const applied: { yearMonth: string; vehicleCount: number }[] = [];
    for (const yearMonth of autoApply) {
      const result = await this.rebuilder.execute({ yearMonth });
      applied.push({ yearMonth, vehicleCount: result.vehicleCount });
    }

    return { appliedYearMonths: autoApply, applied, heldBackYearMonths: heldBack };
  }
}

/** 据え置いた月1つぶんの食い違い。 */
export interface HeldBackMonthDiff extends MonthDiffSummary {
  rows: VehiclePlRowDiff[];
}

export interface MasterChangeStatus {
  /** 確定済みで、いまのマスタと数字が食い違っている月 */
  months: HeldBackMonthDiff[];
  /** 直した履歴 (新しい順) */
  edits: MasterEditRecord[];
  /** 確定済み月へ反映した記録 (新しい順) */
  applies: ConfirmedMonthApplyRecord[];
}

/**
 * 据え置いている月がいまのマスタとどう違うかを求める。
 *
 * 確定済みの月ぶんだけ作り直しの計算を回すので、保存はしないとはいえ安くはない。
 * マスタを保存するたびに走らせず、画面を開いたときにだけ求める。
 */
export class GetMasterChangeStatusUseCase {
  constructor(
    private readonly historyRepo: MasterChangeHistoryRepository,
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly previewer: MonthlyPlPreviewer,
  ) {}

  async execute(options?: { historyLimit?: number }): Promise<MasterChangeStatus> {
    const limit = options?.historyLimit ?? 20;
    const [allMonths, edits, applies] = await Promise.all([
      this.historyRepo.listMonthlyConfirmations(),
      this.historyRepo.listEdits(limit),
      this.historyRepo.listApplies(limit),
    ]);

    const closed = allMonths.filter(isMonthClosed).map((m) => m.yearMonth).sort();

    const months: HeldBackMonthDiff[] = [];
    for (const yearMonth of closed) {
      const [stored, recomputed] = await Promise.all([
        this.vehiclePlRepo.findByYearMonth(yearMonth),
        this.previewer.preview(yearMonth),
      ]);
      const rows = diffVehiclePlRows(stored, recomputed);
      if (rows.length === 0) continue;
      months.push({ ...summarizeMonthDiff(yearMonth, rows), rows });
    }

    return { months, edits, applies };
  }
}

/**
 * 確定済みの月へ、いまのマスタの内容を反映する (人が明示的に選んだときだけ)。
 *
 * 反映しても確定は外さない。締めた月であることは業務上の事実で、
 * 数字を直したことでその事実まで巻き戻ると、締め直しの作業が毎回発生してしまう。
 * (upsertMany は確定を0に戻すので、作り直しのあとで確定を付け直す)
 */
export class ApplyToConfirmedMonthUseCase {
  constructor(
    private readonly historyRepo: MasterChangeHistoryRepository,
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly previewer: MonthlyPlPreviewer,
    private readonly rebuilder: MonthlyPlRebuilder,
  ) {}

  async execute(input: {
    yearMonth: string;
    actor: { id: string | null; name: string };
  }): Promise<{ applyId: string; summary: MonthDiffSummary }> {
    const months = await this.historyRepo.listMonthlyConfirmations();
    const target = months.find((m) => m.yearMonth === input.yearMonth);
    if (!target || !isMonthClosed(target)) {
      throw new Error("この月は確定済みではありません。まだ締めていない月は自動で反映されます");
    }

    const [stored, recomputed] = await Promise.all([
      this.vehiclePlRepo.findByYearMonth(input.yearMonth),
      this.previewer.preview(input.yearMonth),
    ]);
    const rows = diffVehiclePlRows(stored, recomputed);
    if (rows.length === 0) {
      throw new Error("この月はいまのマスタと同じ内容です。反映するものがありません");
    }
    const summary = summarizeMonthDiff(input.yearMonth, rows);

    // 反映前の姿を先に残す。作り直しの途中で落ちても、戻す材料だけは手元にある状態にする。
    const applyId = await this.historyRepo.recordApply({
      yearMonth: input.yearMonth,
      summary: `${summary.vehicleCount}台の数字が変わりました`,
      snapshot: stored,
      actor: input.actor,
    });

    await this.rebuilder.execute({ yearMonth: input.yearMonth });
    // 作り直すと確定が外れるので、締めた月であることを戻す
    await this.vehiclePlRepo.setConfirmed(input.yearMonth, true);

    return { applyId, summary };
  }
}

/**
 * 確定済み月への反映を取り消し、反映前の収支表に戻す。
 *
 * マスタの値そのものは戻さない (別の月では正しい値かもしれないため)。
 * 「この月だけ、反映する前の姿に戻す」操作として閉じる。
 */
export class RevertConfirmedMonthApplyUseCase {
  constructor(
    private readonly historyRepo: MasterChangeHistoryRepository,
    private readonly vehiclePlRepo: VehiclePlRepository,
  ) {}

  async execute(input: {
    applyId: string;
    actor: { id: string | null; name: string };
  }): Promise<{ yearMonth: string; restoredCount: number }> {
    const record = await this.historyRepo.findApplySnapshot(input.applyId);
    if (!record) throw new Error("その反映の記録が見つかりません");
    if (record.revertedAt !== null) throw new Error("この反映はすでに取り消されています");

    const { yearMonth, snapshot } = record;

    // いまの行をいったん全部落としてから書き戻す。反映で増えた車の行が残ると、
    // 戻したつもりの表に見覚えのない行が混ざる。
    const current = await this.vehiclePlRepo.findByYearMonth(yearMonth);
    await this.vehiclePlRepo.removeVehicles(
      yearMonth,
      current.map((r) => r.no),
    );
    await this.vehiclePlRepo.upsertMany(yearMonth, snapshot);
    // 反映前は確定済みだったので、確定済みに戻す
    await this.vehiclePlRepo.setConfirmed(yearMonth, true);
    await this.historyRepo.markApplyReverted(input.applyId, input.actor.id);

    return { yearMonth, restoredCount: snapshot.length };
  }
}

/**
 * 直した値をマスタに書き戻すもの。マスタの種類ごとの書き方を隠す。
 *
 * 「元に戻す」は、直したときと同じ入口を逆向きに通すだけにしたい。
 * 元に戻す専用の書き込み経路を作ると、直すときの検証(率は0〜1など)を通らない道が増える。
 */
export interface MasterValueWriter {
  write(input: {
    targetKind: MasterEditTargetKind;
    targetKey: string;
    field: string;
    value: string | null;
  }): Promise<void>;
}

/**
 * マスタの直しを1件取り消し、直す前の値に戻す。
 *
 * 戻したあとの反映は、直したときとまったく同じ規則に従う
 * (まだ締めていない月は自動で戻り、確定済みの月は据え置かれて食い違いに出る)。
 * 取り消しだけ特別扱いにすると、確定済みの月が知らないうちに変わる道が1本できてしまう。
 */
export class UndoMasterEditUseCase {
  constructor(
    private readonly historyRepo: MasterChangeHistoryRepository,
    private readonly writer: MasterValueWriter,
    private readonly applier: ApplyMasterChangeUseCase,
  ) {}

  async execute(input: {
    editId: string;
    actor: { id: string | null; name: string };
  }): Promise<{ record: MasterEditRecord; result: ApplyMasterChangeResult }> {
    const record = await this.historyRepo.findEdit(input.editId);
    if (!record) throw new Error("その直しの記録が見つかりません");
    if (record.undoneAt !== null) throw new Error("この直しはすでに元に戻されています");

    await this.writer.write({
      targetKind: record.targetKind,
      targetKey: record.targetKey,
      field: record.field,
      value: record.beforeValue,
    });
    await this.historyRepo.markEditUndone(record.id, input.actor.id);

    // 戻したことも1件の直しとして残す。履歴が「直した/戻した」の両方向で読めないと、
    // いまの値がどの操作の結果なのかを後から辿れない。
    const result = await this.applier.execute({
      edits: [
        {
          targetKind: record.targetKind,
          targetKey: record.targetKey,
          targetLabel: record.targetLabel,
          field: record.field,
          fieldLabel: record.fieldLabel,
          beforeValue: record.afterValue,
          afterValue: record.beforeValue,
        },
      ],
      actor: input.actor,
      onlyYearMonth: onlyYearMonthOfRateEdit(record),
    });

    return { record, result };
  }
}

/**
 * その直しが1つの月にしか効かないなら、その年月を返す。
 *
 * 率マスタの月別値 (targetKey が "キー|2026-05") だけがこれに当たる。
 * 車両・運転者マスタと全期間共通の率は、収支表がある未確定の月すべてに効く。
 */
export function onlyYearMonthOfRateEdit(record: {
  targetKind: MasterEditTargetKind;
  targetKey: string;
}): string | null {
  if (record.targetKind !== "rate") return null;
  const yearMonth = record.targetKey.split("|")[1] ?? "";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth) ? yearMonth : null;
}
