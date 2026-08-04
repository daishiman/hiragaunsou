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
  /** 取込時に機械的に除外した行数 (傭車=車番88888)。「何件を自動で処理したか」を人に示すために持つ */
  excludedRowCount: integer("excluded_row_count").notNull().default(0),
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
  (table) => [
    index("raw_ingestion_batch_idx").on(table.batchId),
    index("raw_ingestion_ym_source_idx").on(table.yearMonth, table.sourceType),
  ],
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
 * 年間集計の参照値 (S8 年間集計・対前年画面)。
 *
 * 月次データ(vehicle_pl)から自動集計できない外部の数字だけを持つ:
 *  - prev_year_actual : 前年度実績 (対前年比較の相手方。月次データが無い期間の実績)
 *  - excel_annual_sheet: 現行Excelの年間集計シートの転記値 (自動突合してズレを可視化するための比較元)
 *
 * 集計・損益などの下流の値は手入力できない構造にする方針のため、このテーブルは
 * 「月次から計算できない外部由来の値」だけを保持し、当年度の集計値は保存しない。
 */
export const annualReference = sqliteTable(
  "annual_reference",
  {
    id: text("id").primaryKey(),
    /** prev_year_actual / excel_annual_sheet */
    kind: text("kind").notNull(),
    yearMonth: text("year_month").notNull(), // YYYY-MM
    sales: real("sales").notNull().default(0),
    expense: real("expense").notNull().default(0),
    note: text("note"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedBy: text("updated_by").references(() => user.id),
  },
  (table) => [uniqueIndex("annual_reference_kind_ym_idx").on(table.kind, table.yearMonth)],
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

/**
 * 業務フロー STEP3(燃料費) / STEP5(修繕費・タイヤ) / STEP6(高速料金) の人手入力値。
 *
 * これらは月内の別々のタイミングで請求書が届くため、1回で入力し切れない。
 * 入力を保存して再開・その場修正できるようにするため、確定(vehicle_pl)とは別に保持する。
 * vehicle_pl は常にこの値から再計算されるので、こちらが人手入力の唯一の正本になる。
 */
export const manualVehicleInput = sqliteTable(
  "manual_vehicle_input",
  {
    id: text("id").primaryKey(),
    yearMonth: text("year_month").notNull(),
    vehicleNo: text("vehicle_no").notNull(),
    /** STEP3 燃料費 */
    fuelInQty: real("fuel_in_qty").notNull().default(0),
    fuelOut: real("fuel_out").notNull().default(0),
    fuelOutQty: real("fuel_out_qty").notNull().default(0),
    adblue: real("adblue").notNull().default(0),
    /** STEP5 経費(修繕費・タイヤ)。tire_actual は null のとき km×単価の標準原価にフォールバックする */
    repairActual: real("repair_actual").notNull().default(0),
    tireActual: real("tire_actual"),
    equip: real("equip").notNull().default(0),
    mainte: real("mainte").notNull().default(0),
    /** STEP6 高速料金。null のとき売上モニタリスト由来の通行料と組合割引率で近似する */
    tollActual: real("toll_actual"),
    tollDiscountActual: real("toll_discount_actual"),
    /** STEP2 キリン配賦を含む「その他」諸経費 */
    miscOther: real("misc_other").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedBy: text("updated_by").references(() => user.id),
  },
  (table) => [
    uniqueIndex("manual_vehicle_input_ym_no_idx").on(table.yearMonth, table.vehicleNo),
    index("manual_vehicle_input_ym_idx").on(table.yearMonth),
  ],
);

/**
 * 業務フロー STEP1「データ整形(傭車・2重計上・諸口の処理)」で人が下した判断の履歴。
 *
 * 判定ルール(車番88888=傭車 / 888・10・5000番=2重計上疑い / 運転者「諸口」)はシステムが持ち、
 * 最終判断は人が1クリックで下す。その判断をここに残すことで
 *  - なぜその伝票が収支表に入っていない(入っている)かを後から説明できる
 *  - 翌月に同じ伝票が上がってきたとき「前月はこう判断した」と提案できる
 * ようにする。row_key は伝票の自然キー(管理№-行№)。
 */
export const cleansingDecision = sqliteTable(
  "cleansing_decision",
  {
    id: text("id").primaryKey(),
    yearMonth: text("year_month").notNull(),
    sourceType: text("source_type").notNull(),
    rowKey: text("row_key").notNull(),
    vehicleNo: text("vehicle_no"),
    driverName: text("driver_name"),
    /** 立っていたフラグ種別 (JSON配列文字列: chartered/duplicate_suspect/misc_entry) */
    flagTypes: text("flag_types").notNull(),
    /** delete(除外する) / correct(修正して残す) / keep(そのまま残す) */
    decision: text("decision").notNull(),
    /** correct のとき、正しい車番へ付け替える */
    correctedVehicleNo: text("corrected_vehicle_no"),
    note: text("note"),
    decidedBy: text("decided_by").references(() => user.id),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("cleansing_decision_ym_src_row_idx").on(
      table.yearMonth,
      table.sourceType,
      table.rowKey,
    ),
    index("cleansing_decision_ym_idx").on(table.yearMonth),
    index("cleansing_decision_row_idx").on(table.sourceType, table.rowKey),
  ],
);

/**
 * 業務ルールのうち、コードに埋めたくない設定値。
 * 例: キリンの輸送協力金・経営支援金の配賦先車番 (現状24番・300番だが、専属車両が変われば変わる)。
 */
export const appSetting = sqliteTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedBy: text("updated_by").references(() => user.id),
});
