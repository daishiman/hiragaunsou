import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "./client";
import { appSetting, cleansingDecision } from "./schema";
import type {
  AppSettingRepository,
  CleansingDecisionRecord,
  CleansingDecisionRepository,
} from "../../domain/repositories/CleansingDecisionRepository";
import type { CleansingDecisionType, CleansingFlagType } from "../../domain/rules/cleansingRules";

/** D1が1文でバインドできる変数の上限に触れないよう、IN句を分割する単位 */
const IN_CHUNK_SIZE = 90;

function toRecord(r: typeof cleansingDecision.$inferSelect): CleansingDecisionRecord {
  return {
    yearMonth: r.yearMonth,
    sourceType: r.sourceType,
    rowKey: r.rowKey,
    vehicleNo: r.vehicleNo,
    driverName: r.driverName,
    flagTypes: JSON.parse(r.flagTypes) as CleansingFlagType[],
    decision: r.decision as CleansingDecisionType,
    correctedVehicleNo: r.correctedVehicleNo,
    note: r.note,
  };
}

/**
 * D1(Drizzle)による CleansingDecisionRepository の実装。
 * year_month + source_type + row_key の一意制約で upsert するため、
 * 同じ伝票の判断を何度やり直しても行が増えない(=判断のやり直しが安全)。
 */
export class D1CleansingDecisionRepository implements CleansingDecisionRepository {
  constructor(private readonly db: Db) {}

  async findByYearMonth(yearMonth: string, sourceType: string): Promise<CleansingDecisionRecord[]> {
    const rows = await this.db
      .select()
      .from(cleansingDecision)
      .where(
        and(
          eq(cleansingDecision.yearMonth, yearMonth),
          eq(cleansingDecision.sourceType, sourceType),
        ),
      );
    return rows.map(toRecord);
  }

  async countByYearMonth(yearMonth: string, sourceType: string): Promise<number> {
    const rows = await this.db
      .select({ count: count() })
      .from(cleansingDecision)
      .where(
        and(
          eq(cleansingDecision.yearMonth, yearMonth),
          eq(cleansingDecision.sourceType, sourceType),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  async findPreviousDecisions(
    sourceType: string,
    rowKeys: readonly string[],
    beforeYearMonth: string,
  ): Promise<CleansingDecisionRecord[]> {
    if (rowKeys.length === 0) return [];

    // rowKey ごとの最新1件だけが欲しい。D1でウィンドウ関数を使うより、
    // 年月降順で引いて先勝ちで畳むほうが読みやすく、件数も高々「フラグ行数×過去月」で収まる。
    const latestByRowKey = new Map<string, CleansingDecisionRecord>();

    for (let i = 0; i < rowKeys.length; i += IN_CHUNK_SIZE) {
      const chunk = rowKeys.slice(i, i + IN_CHUNK_SIZE);
      const rows = await this.db
        .select()
        .from(cleansingDecision)
        .where(
          and(
            eq(cleansingDecision.sourceType, sourceType),
            inArray(cleansingDecision.rowKey, chunk as string[]),
            lt(cleansingDecision.yearMonth, beforeYearMonth),
          ),
        )
        .orderBy(desc(cleansingDecision.yearMonth));

      for (const row of rows) {
        if (!latestByRowKey.has(row.rowKey)) latestByRowKey.set(row.rowKey, toRecord(row));
      }
    }

    return [...latestByRowKey.values()];
  }

  async upsertMany(
    records: readonly CleansingDecisionRecord[],
    decidedBy: string | null,
  ): Promise<void> {
    if (records.length === 0) return;
    const now = new Date();

    const statements = records.map((record) => {
      const values = {
        decision: record.decision,
        vehicleNo: record.vehicleNo,
        driverName: record.driverName,
        flagTypes: JSON.stringify(record.flagTypes),
        correctedVehicleNo: record.correctedVehicleNo,
        note: record.note,
        decidedBy,
        decidedAt: now,
      };
      return this.db
        .insert(cleansingDecision)
        .values({
          id: `${record.yearMonth}::${record.sourceType}::${record.rowKey}`,
          yearMonth: record.yearMonth,
          sourceType: record.sourceType,
          rowKey: record.rowKey,
          ...values,
        })
        .onConflictDoUpdate({
          target: [
            cleansingDecision.yearMonth,
            cleansingDecision.sourceType,
            cleansingDecision.rowKey,
          ],
          set: values,
        });
    });

    // D1に対話型トランザクションはないため batch() で原子性を担保する
    await this.db.batch(statements as unknown as [(typeof statements)[number]]);
  }
}

/** 業務ルール設定値 (キリン配賦先車番など) の D1 実装。 */
export class D1AppSettingRepository implements AppSettingRepository {
  constructor(private readonly db: Db) {}

  async get(key: string): Promise<string | null> {
    const rows = await this.db.select().from(appSetting).where(eq(appSetting.key, key)).limit(1);
    return rows[0]?.value ?? null;
  }

  async set(key: string, value: string, updatedBy: string | null): Promise<void> {
    const now = new Date();
    await this.db
      .insert(appSetting)
      .values({ key, value, updatedAt: now, updatedBy })
      .onConflictDoUpdate({
        target: [appSetting.key],
        set: { value, updatedAt: now, updatedBy },
      });
  }
}

/** app_setting のキー定義 (文字列の散らばりを防ぐ) */
export const APP_SETTING_KEYS = {
  /** キリンの輸送協力金・経営支援金の配賦先車番 (カンマ区切り) */
  kirinTargetVehicleNos: "kirin_target_vehicle_nos",
} as const;
