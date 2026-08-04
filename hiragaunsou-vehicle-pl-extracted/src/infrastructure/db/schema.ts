import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

/**
 * ドメインスキーマ (収支表本体)。
 *
 * 監査性・再計算可能性のため、原始データ(rawIngestion)と計算済み収支(vehiclePl)を分離する。
 * - rawIngestion: 取込CSVの生値をそのまま year_month + source_type + file 単位で保持。再取込・再計算の根拠。
 * - vehiclePl: 51列 + 実力損益補助フィールドの計算済みスナップショット。year_month + vehicle_no で一意。
 */

/** 取込元ファイル種別 */
export const SOURCE_TYPES = [
  "vehicle_operation", // 車両別運行実績表 (ITP-WEBServiceV3, デジタコ)
  "sales_monitor", // 売上モニタリスト (車楽クラウド)
  "payroll", // 給与集計表(日給者) (ACELINK NX-CE)
  "monthly_pl_workbook", // 既存の完成済み「○月収支表」Excel（移行期間の正本取込）
] as const;

export const csvImportBatch = sqliteTable("csv_import_batch", {
  id: text("id").primaryKey(),
  sourceType: text("source_type").notNull(),
  yearMonth: text("year_month").notNull(), // YYYY-MM
  fileName: text("file_name").notNull(),
  importedAt: integer("imported_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  importedBy: text("imported_by").references(() => user.id),
  rowCount: integer("row_count").notNull().default(0),
  status: text("status").notNull().default("completed"), // completed / failed / partial
});

/** 原始データ (監査用。生のパース結果をJSONで保持し、再計算の根拠にする) */
export const rawIngestion = sqliteTable(
  "raw_ingestion",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => csvImportBatch.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    yearMonth: text("year_month").notNull(),
    rowIndex: integer("row_index").notNull(),
    /** パーサが抽出したキー(車番 or 社員コード) */
    naturalKey: text("natural_key"),
    rawJson: text("raw_json").notNull(),
    /** 傭車(88888)・諸口・2重計上疑いなどのフラグ (JSON配列文字列) */
    flags: text("flags"),
  },
  // D1は「書き込み行数」を索引更新も含めて数えるため、索引を1本持つだけで
  // 取込1行あたりの消費が増える。raw_ingestion は毎月数千行入る最大の書き込み源であり、
  // 無料枠(10万行/日)に最も近づくテーブルなので、索引は実際に引かれるものだけに絞る。
  // batch_id 単独の索引は削除(0003)。取込済みバッチの削除は year_month + source_type で
  // 絞り込んでから batch_id で判定するため、下の複合索引で足りる。
  (table) => [index("raw_ingestion_ym_source_idx").on(table.yearMonth, table.sourceType)],
);

/** 車両マスタ (保険・税・リース・配賦単価等、連鎖確定の土台) */
export const vehicleMaster = sqliteTable("vehicle_master", {
  vehicleNo: text("vehicle_no").primaryKey(),
  vehicleType: text("vehicle_type").notNull(),
  depot: text("depot").notNull().default(""),
  regDate: text("reg_date"),
  costCategory: text("cost_category").notNull().default("medium"), // 6.5t/large/semiTrailer/unic/medium
  insCompulsory: real("ins_compulsory").notNull().default(0),
  insVoluntary: real("ins_voluntary").notNull().default(0),
  taxAuto: real("tax_auto").notNull().default(0),
  taxWeight: real("tax_weight").notNull().default(0),
  lease: real("lease").notNull().default(0),
  installment: real("installment").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/** 運転者マスタ (社員コードで別テーブルから紐づけ。車番と1:1ではない) */
export const driverMaster = sqliteTable("driver_master", {
  employeeCode: text("employee_code").primaryKey(),
  driverName: text("driver_name").notNull(),
  vehicleNo: text("vehicle_no").references(() => vehicleMaster.vehicleNo),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/** レート・原価単価マスタ (一般管理費率・割引率・賞与年額・インタンク単価等。ハードコード禁止対応) */
export const rateMaster = sqliteTable(
  "rate_master",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(), // admin_fee_rate / toll_discount_rate / bonus_annual / tank_price
    /** tank_price のように月次で変わる値は yearMonth を指定。それ以外は null (全期間共通) */
    yearMonth: text("year_month"),
    value: real("value").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedBy: text("updated_by").references(() => user.id),
  },
  (table) => [uniqueIndex("rate_master_key_ym_idx").on(table.key, table.yearMonth)],
);

/** 計算済み収支表 (51列 + 実力損益補助フィールド)。year_month + vehicle_no で一意 */
export const vehiclePl = sqliteTable(
  "vehicle_pl",
  {
    id: text("id").primaryKey(),
    yearMonth: text("year_month").notNull(),
    vehicleNo: text("vehicle_no").notNull(),
    type: text("type").notNull().default(""),
    depot: text("depot").notNull().default(""),
    reg: text("reg"),
    code: text("code"),
    driver: text("driver"),
    trips: real("trips").notNull().default(0),
    slips: real("slips").notNull().default(0),
    hours: real("hours").notNull().default(0),
    km: real("km").notNull().default(0),
    fare: real("fare").notNull().default(0),
    fee: real("fee").notNull().default(0),
    sales: real("sales").notNull().default(0),
    toll: real("toll").notNull().default(0),
    tollDisc: real("toll_disc").notNull().default(0),
    tollNet: real("toll_net").notNull().default(0),
    fuelIn: real("fuel_in").notNull().default(0),
    fuelInQty: real("fuel_in_qty").notNull().default(0),
    fuelOut: real("fuel_out").notNull().default(0),
    fuelOutQty: real("fuel_out_qty").notNull().default(0),
    fuelQty: real("fuel_qty").notNull().default(0),
    nempi: real("nempi").notNull().default(0),
    adblue: real("adblue").notNull().default(0),
    fuelTotal: real("fuel_total").notNull().default(0),
    repair: real("repair").notNull().default(0), // 実費
    repairStandard: real("repair_standard").notNull().default(0), // 標準原価 (実力損益用, 51列外の補助)
    tire: real("tire").notNull().default(0),
    equip: real("equip").notNull().default(0),
    mainte: real("mainte").notNull().default(0),
    repairTotal: real("repair_total").notNull().default(0),
    salary: real("salary").notNull().default(0),
    bonus: real("bonus").notNull().default(0),
    welfare: real("welfare").notNull().default(0),
    laborTotal: real("labor_total").notNull().default(0),
    insCompulsory: real("ins_compulsory").notNull().default(0),
    insVoluntary: real("ins_voluntary").notNull().default(0),
    insTotal: real("ins_total").notNull().default(0),
    taxAuto: real("tax_auto").notNull().default(0),
    taxWeight: real("tax_weight").notNull().default(0),
    taxTotal: real("tax_total").notNull().default(0),
    miscOther: real("misc_other").notNull().default(0),
    miscTotal: real("misc_total").notNull().default(0),
    lease: real("lease").notNull().default(0),
    installment: real("installment").notNull().default(0),
    transportTotal: real("transport_total").notNull().default(0),
    adminFee: real("admin_fee").notNull().default(0),
    adminTotal: real("admin_total").notNull().default(0),
    fixed: real("fixed").notNull().default(0),
    variable: real("variable").notNull().default(0),
    expense: real("expense").notNull().default(0),
    profit: real("profit").notNull().default(0),
    margin: real("margin").notNull().default(0),
    /** 締め確定フラグ (確定後は上書き時に根拠メモ必須にする運用。このスライスでは保持のみ) */
    confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("vehicle_pl_ym_no_idx").on(table.yearMonth, table.vehicleNo),
    index("vehicle_pl_ym_idx").on(table.yearMonth),
  ],
);

/**
 * 要確認リスト / ToDo (F2, F7)。
 * type: missing_input(未入力) / duplicate_suspect(2重計上疑い) / misc_entry(諸口)
 *       / anomaly_digit(桁ミス疑い) / anomaly_range(例月レンジ逸脱) / anomaly_yoy(前年同月比)
 */
export const reviewFlag = sqliteTable(
  "review_flag",
  {
    id: text("id").primaryKey(),
    yearMonth: text("year_month").notNull(),
    vehicleNo: text("vehicle_no"),
    field: text("field"), // 対象フィールド名 (anomaly系のみ)
    type: text("type").notNull(),
    severity: text("severity").notNull().default("info"), // info/warning/critical
    message: text("message").notNull(),
    /** 判断材料: 例月の目安値 (5月入力確認シートH列相当) */
    monthlyReference: real("monthly_reference"),
    status: text("status").notNull().default("open"), // open / corrected / approved / dismissed
    resolvedBy: text("resolved_by").references(() => user.id),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolutionNote: text("resolution_note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("review_flag_ym_status_idx").on(table.yearMonth, table.status),
    index("review_flag_vehicle_idx").on(table.vehicleNo),
  ],
);

/**
 * AI(Claude API等)呼び出しの利用量ログ。/usage 画面で概算費用・利用者別内訳を出すための唯一の記録先。
 * kind: factor_analysis_report(要因分析レポート) / pdf_ocr_extract(PDF OCR抽出) 等、呼び出し用途を識別する。
 */
export const usageLog = sqliteTable(
  "usage_log",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    recordedBy: text("recorded_by").references(() => user.id),
    detailJson: text("detail_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("usage_log_kind_created_idx").on(table.kind, table.createdAt),
    index("usage_log_recorded_by_idx").on(table.recordedBy),
  ],
);
