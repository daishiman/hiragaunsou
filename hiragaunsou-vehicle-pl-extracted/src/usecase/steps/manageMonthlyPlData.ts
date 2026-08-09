import type { AuditLogRecord, AuditLogRepository } from "../../domain/repositories/AuditLogRepository";

export const DELETE_MONTHLY_PL_ACTION = "delete_monthly_pl";

/** 収支表がある月の要約。消す前に「何がどれだけ消えるか」を見せるために使う。 */
export interface MonthlyPlSummary {
  yearMonth: string;
  vehicleCount: number;
  sales: number;
  profit: number;
  /** 確定済みの台数。1台でもあれば締めた月なので消させない。 */
  confirmed: number;
}

/** このユースケースが必要とする収支表の読み書きだけを型で受ける(差し替え可能にするため)。 */
export interface MonthlyPlDataRepository {
  listYearMonthSummaries(): Promise<MonthlyPlSummary[]>;
  deleteYearMonth(yearMonth: string): Promise<number>;
}

/** 取込のある月を知るための最小の型。 */
export interface ImportedMonthsRepository {
  listYearMonths(limit: number): Promise<string[]>;
}

/** 取込の履歴を24か月ぶん見れば、業務上の対象期間は十分に覆える。 */
const MONTHS_TO_SCAN = 240;

/**
 * 「取込が1件も無いのに収支表だけがある月」を探す。
 *
 * 収支表の行は車両マスタの車両から作られるため、取込が無くても台数ぶんの行が作れてしまう
 * 経路があった(現在は塞いである)。そうしてできた月は、走行も売上も0で固定費だけが並ぶ
 * 赤字の行になり、ホームの経営サマリや年間集計に架空の数字として混ざる。
 *
 * すでにできてしまった分は、どの月がそれに当たるのかを人が探し回らなくて済むよう、
 * ここで一覧にして画面に出す。消すかどうかを決めるのは利用者。
 */
export class ListMonthsWithoutImportsUseCase {
  constructor(
    private readonly plRepo: MonthlyPlDataRepository,
    private readonly importRepo: ImportedMonthsRepository,
  ) {}

  async execute(): Promise<MonthlyPlSummary[]> {
    const [summaries, importedMonths] = await Promise.all([
      this.plRepo.listYearMonthSummaries(),
      this.importRepo.listYearMonths(MONTHS_TO_SCAN),
    ]);
    const imported = new Set(importedMonths);
    return summaries.filter((s) => !imported.has(s.yearMonth));
  }
}

export interface DeleteMonthlyPlInput {
  actorId: string;
  actorName: string;
  yearMonth: string;
}

export interface DeleteMonthlyPlResult {
  yearMonth: string;
  deletedRows: number;
}

/**
 * 取込が無い月の収支表を消す。
 *
 * 消してよいのは「取込が1件も無い月」だけに限る。取込のある月の収支表は取り込んだ内容から
 * いつでも作り直せる一方、ここで月を指定して消せるようにすると、締め作業中の月を1回の操作で
 * 空にできてしまう。復旧の手間が釣り合わないので、対象を構造的に絞る。
 *
 * 確定済み(締め済み)の月も消さない。確定は「この数字で締めた」という人の意思表示で、
 * それを消すのは記録を消すことにあたる。取込が無いのに確定済み、という組み合わせは
 * 通常の業務では起こらないため、起きているなら誤操作の可能性が高い。
 * まず確定を取り消してもらい、意思表示を1つずつ戻す形にする。
 */
export class DeleteMonthlyPlUseCase {
  constructor(
    private readonly plRepo: MonthlyPlDataRepository,
    private readonly importRepo: ImportedMonthsRepository,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async execute(input: DeleteMonthlyPlInput): Promise<DeleteMonthlyPlResult> {
    const [summaries, importedMonths] = await Promise.all([
      this.plRepo.listYearMonthSummaries(),
      this.importRepo.listYearMonths(MONTHS_TO_SCAN),
    ]);

    const target = summaries.find((s) => s.yearMonth === input.yearMonth);
    if (!target) {
      throw new Error("その月の収支表は見つかりませんでした(既に消えている可能性があります)");
    }
    if (importedMonths.includes(input.yearMonth)) {
      throw new Error(
        "その月にはファイルが取り込まれています。取り込んだ内容から作られた収支表はここでは消せません",
      );
    }
    if (target.confirmed > 0) {
      throw new Error(
        "その月は確定済みです。消すには、先に月次収支表で確定を取り消してください",
      );
    }

    const deletedRows = await this.plRepo.deleteYearMonth(input.yearMonth);

    await this.auditLog.record({
      actorId: input.actorId,
      actorName: input.actorName,
      action: DELETE_MONTHLY_PL_ACTION,
      summary: `${input.yearMonth} の収支表 ${deletedRows}台分を削除(取込なし・売上${Math.round(target.sales)}円)`,
      detail: { ...target, deletedRows },
    });

    return { yearMonth: input.yearMonth, deletedRows };
  }
}

/** 消した履歴の確認(管理画面)。 */
export class ListMonthlyPlDeletionLogUseCase {
  constructor(private readonly auditLog: AuditLogRepository) {}

  async execute(limit = 50): Promise<AuditLogRecord[]> {
    return this.auditLog.listRecent(DELETE_MONTHLY_PL_ACTION, limit);
  }
}
