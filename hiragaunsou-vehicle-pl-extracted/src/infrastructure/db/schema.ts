import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";
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
  // D1は「書き込み行数」を索引更新も含めて数えるため、索引を1本持つだけで
  // 取込1行あたりの消費が増える。raw_ingestion は毎月数千行入る最大の書き込み源であり、
  // 無料枠(10万行/日)に最も近づくテーブルなので、索引は実際に引かれるものだけに絞る。
  // batch_id 単独の索引は削除(0003)。取込済みバッチの削除は year_month + source_type で
  // 絞り込んでから batch_id で判定するため、下の複合索引で足りる。
  (table) => [index("raw_ingestion_ym_source_idx").on(table.yearMonth, table.sourceType)],
);

/**
 * 管理操作の監査ログ (誰が/いつ/何をしたか)。
 * 当面は取込バッチ削除(csv_import_batch/raw_ingestion)のみを記録する。
 * 対象が既に消えた後も「何を消したか」を追える必要があるため、対象テーブルへの
 * 外部キーは持たず、削除時点のスナップショットをJSONで保持する。
 */
export const adminAuditLog = sqliteTable("admin_audit_log", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").references(() => user.id),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(), // 例: "delete_import_batch"
  summary: text("summary").notNull(), // 画面に出す人間可読な要約
  detailJson: text("detail_json"), // 構造化データ(JSON文字列)
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/**
 * ファイル取込の記録 (どの画面から・何を・いつ取り込んだか)。
 *
 * csv_import_batch は月次帳票の取込だけを持ち、マスタ取込は記録が残らなかった。
 * 「同じファイルをもう一度取り込もうとしている」を検知するには、画面を問わず
 * 中身の指紋(content_hash)を残す必要があるため、取込の入口すべてで1件書く。
 * 仕様は docs/product/file-import-common-spec.md。
 */
export const fileImportLog = sqliteTable(
  "file_import_log",
  {
    id: text("id").primaryKey(),
    /** import / vehicle_master / driver_master */
    screen: text("screen").notNull(),
    sourceType: text("source_type").notNull(),
    /** 月に紐づかない取込(マスタ)は null */
    yearMonth: text("year_month"),
    /** 参考情報。判定には使わない(名前は毎月変わる) */
    fileName: text("file_name").notNull(),
    /** 中身のSHA-256。同一ファイルの判定はこれだけで行う */
    contentHash: text("content_hash").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    importedAt: integer("imported_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    /** 利用者を消しても記録は残す(消えると二重取込の照合が効かなくなる)。誰が入れたかは名前で残る。 */
    importedBy: text("imported_by").references(() => user.id, { onDelete: "set null" }),
    importedByName: text("imported_by_name").notNull().default(""),
  },
  // 重複判定は「中身が同じか」「同じ名前が過去にあるか」の2軸を引く。
  (table) => [
    index("file_import_log_hash_idx").on(table.contentHash),
    index("file_import_log_screen_idx").on(table.screen, table.importedAt),
    index("file_import_log_name_idx").on(table.fileName),
  ],
);

/** 車両マスタ (保険・税・リース・配賦単価等、連鎖確定の土台) */
export const vehicleMaster = sqliteTable("vehicle_master", {
  vehicleNo: text("vehicle_no").primaryKey(),
  vehicleType: text("vehicle_type").notNull(),
  depot: text("depot").notNull().default(""),
  regDate: text("reg_date"),
  costCategory: text("cost_category").notNull().default("medium"), // 6.5t/large/semiTrailer/unic/medium/trailer
  /**
   * トレーラ(被けん引車)が、どのトラクタにけん引されるか。トレーラ行だけが持つ。
   * この対応表は元データのどのCSVにも無く、現行Excelの行ラベル(「129/1113」)だけが
   * 持っている情報なので、人が登録する場所としてマスタに置く。
   */
  towedByVehicleNo: text("towed_by_vehicle_no"),
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
    /**
     * この行が吸収したトレーラの車番 (カンマ区切り。無ければ空文字)。
     * 車番はトラクタのままにしてある。合成キーにすると運行実績・給与・手入力・上書きが
     * 全てトラクタの車番でキーされている紐づけが切れるため、表示ラベルはここから組み立てる。
     */
    towedVehicleNos: text("towed_vehicle_nos").notNull().default(""),
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
 * 車両単位の最終上書き (STEP7の確定後に、請求側の事情で人が直す値)。
 *
 * valuesJson に入るのは OVERRIDABLE_FIELDS(計算の入口の値)だけ。損益や小計は入らない。
 * 列を増やさず JSON にしているのは、上書き対象が運用の中で増減するのに対して
 * 「何を上書きできるか」の定義は domain/rules/vehiclePlOverride.ts の1箇所に置きたいため。
 * 読み出し時に isOverridableField で濾すので、古い定義が残っていても下流には流れない。
 */
export const vehiclePlOverride = sqliteTable(
  "vehicle_pl_override",
  {
    id: text("id").primaryKey(),
    yearMonth: text("year_month").notNull(),
    vehicleNo: text("vehicle_no").notNull(),
    /** その月の収支表からこの車両を外す (車番303の「今月は載せない」扱い) */
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    valuesJson: text("values_json").notNull().default("{}"),
    /** なぜ直したか。空を許すと後から誰も判断を追えなくなるため notNull */
    reason: text("reason").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedBy: text("updated_by").references(() => user.id),
    /**
     * この直しを収支表へ反映(再計算)した時刻。NULL は「まだ反映していない」。
     *
     * 収支表の画面では指摘を何件も続けて直すため、1件ごとに月まるごとの再計算を走らせると
     * 待ち時間が積み上がる。保存と反映を切り離す代わりに、未反映であることをここに残して
     * 「反映待ちN件」を画面が示せるようにする(反映漏れを人の記憶に頼らせない)。
     */
    appliedAt: integer("applied_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("vehicle_pl_override_ym_no_idx").on(table.yearMonth, table.vehicleNo),
    index("vehicle_pl_override_ym_idx").on(table.yearMonth),
  ],
);

/**
 * 収支表の指摘に対して人が下した「このままでよい」の記録。
 *
 * 指摘(VehiclePlIssue)はDBに持たず、収支表と各マスタから表示のたびに導出される。
 * そのため確認済みの印は指摘そのものではなく、指摘を指す4つ組
 * (年月・車番・列・指摘の種類)をキーにして別に保持する。
 *
 * 年月をキーに含めているので、翌月に同じ指摘が出たときは必ずもう一度表示される。
 * 「先月OKだった」は「今月もOK」の根拠にならない(金額が変われば判断も変わる)ため。
 */
export const plIssueAck = sqliteTable(
  "pl_issue_ack",
  {
    id: text("id").primaryKey(),
    yearMonth: text("year_month").notNull(),
    vehicleNo: text("vehicle_no").notNull(),
    /** 指摘が付いている列 (VehiclePlField) */
    field: text("field").notNull(),
    /** 指摘の種類 (ReviewIssueCode) */
    code: text("code").notNull(),
    /** 補足メモ (任意)。なぜそのままでよいのかを一言残せるようにする */
    note: text("note"),
    /** 人が下した判断。'ok' = 問題なし / 'later' = あとで見る (後回し) */
    status: text("status").notNull().default("ok"),
    /** 判断したときの値。翌月に引き継ぐかどうか (値が大きく変わっていないか) の判定に使う */
    valueAtAck: real("value_at_ack"),
    ackedAt: integer("acked_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    ackedBy: text("acked_by").references(() => user.id),
  },
  (table) => [
    uniqueIndex("pl_issue_ack_key_idx").on(
      table.yearMonth,
      table.vehicleNo,
      table.field,
      table.code,
    ),
    index("pl_issue_ack_ym_idx").on(table.yearMonth),
    index("pl_issue_ack_status_idx").on(table.yearMonth, table.status),
  ],
);

/**
 * 業務フロー STEP2「データ整形(傭車・2重計上・諸口の処理)」で人が下した判断の履歴。
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

/** AI分析(要因分析レポート等)に使うプロバイダ種別 */
export const AI_PROVIDERS = ["anthropic", "openai", "google", "xai"] as const;

/**
 * AI分析用の外部APIキー (管理者専用画面から登録)。
 *
 * apiKeyCipher / apiKeyIv は AES-GCM で暗号化した値のみを保持し、平文のAPIキーは
 * 一切保存しない。復号鍵は D1 ではなく Cloudflare Workers Secrets
 * (env.API_KEY_ENCRYPTION_SECRET) から取得するため、この D1 データベースの内容だけを
 * 見ても平文キーは復元できない。復号は src/infrastructure/security の暗号化ユーティリティ
 * 経由でサーバー側 (admin権限チェック済みのRoute Handler) からのみ行う想定であり、
 * 画面・APIレスポンスの双方で平文キーやその一部を返してはならない (登録済みかどうかの
 * 真偽値と末尾4桁のマスク表示のみ許可)。
 *
 * 編集は常に上書き保存のみ (既存レコードの部分更新はしない)。provider ごとに1件だけ持つ。
 */
export const aiProviderCredential = sqliteTable("ai_provider_credential", {
  provider: text("provider").primaryKey(), // anthropic / openai / google / xai
  apiKeyCipher: text("api_key_cipher").notNull(),
  apiKeyIv: text("api_key_iv").notNull(),
  /** 表示用: キー末尾4文字のみ (一覧でどのキーか見分けるため。復元には使えない) */
  apiKeyLast4: text("api_key_last4").notNull(),
  /** 選択中のモデルID (プロバイダのモデルカタログのいずれか) */
  model: text("model").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedBy: text("updated_by").references(() => user.id),
});

/**
 * ユーザー招待(仮登録)。管理者が /admin/users からメールアドレス+ロールを予約すると、
 * 本人が実際にGoogle Workspaceアカウントで初めてサインインした時点で、そのロールが
 * 自動的に適用される (src/infrastructure/auth/auth.ts の user.create.before フック参照)。
 * ログインの許可・拒否自体はWORKSPACE_DOMAINS(hd claim検証)がそのまま担う。
 */
export const userInvitation = sqliteTable("user_invitation", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: text("role").notNull(),
  invitedBy: text("invited_by")
    .notNull()
    .references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
  revoked: integer("revoked", { mode: "boolean" }).default(false).notNull(),
  /**
   * "google": 既存方式。本人が実際にGoogle Workspaceアカウントで初めてサインインした時点で
   *   ロールが適用される(user.create.beforeフック)。
   * "password": Gmailを持たない社内ユーザー向け。招待作成と同時にuser行を作成し、
   *   better-auth標準のパスワードリセット機構(requestPasswordReset/resetPassword)で
   *   発行した初期パスワード設定リンクを管理者が本人へ安全な経路で手渡しする。
   *   本人が実際にパスワードを設定して初めてサインインした時点でacceptedAtが確定する
   *   (session.create.beforeフック)。
   */
  authMethod: text("auth_method").notNull().default("google"),
});

/**
 * マスタ(率・車両・運転者)を直した履歴。
 *
 * マスタは「間違っていれば後から直せる」ことが前提の場所なので、直した事実そのものを
 * 残さないと、収支表の数字が変わった理由を誰も説明できなくなる。
 * 元に戻す操作もここを起点にする (undoneAt が入った行は取り消し済み)。
 *
 * 値を文字列で持つのは、率(0.1748)・金額(120000)・運転者名・車番が同じ一覧に並ぶため。
 * 型ごとに列を分けると、履歴を読む画面が値の種類だけ分岐を持つことになる。
 */
export const masterEditHistory = sqliteTable(
  "master_edit_history",
  {
    id: text("id").primaryKey(),
    /** rate / vehicle / driver */
    targetKind: text("target_kind").notNull(),
    /** 率: "キー|年月" / 車両: 車番 / 運転者: 社員コード */
    targetKey: text("target_key").notNull(),
    /** 対象が後で消えても履歴が読めるよう、表示名をそのとき固定して持つ */
    targetLabel: text("target_label").notNull(),
    field: text("field").notNull(),
    fieldLabel: text("field_label").notNull(),
    beforeValue: text("before_value"),
    afterValue: text("after_value"),
    /** 利用者を消しても履歴は残す (消えると誰が直したかを追えなくなる)。名前は下の列に残る */
    editedBy: text("edited_by").references(() => user.id, { onDelete: "set null" }),
    editedByName: text("edited_by_name").notNull().default(""),
    editedAt: integer("edited_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    /** 元に戻した時刻。NULL は「生きている直し」 */
    undoneAt: integer("undone_at", { mode: "timestamp_ms" }),
    undoneBy: text("undone_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    index("master_edit_history_at_idx").on(table.editedAt),
    index("master_edit_history_target_idx").on(table.targetKind, table.targetKey),
  ],
);

/**
 * 確定済みの月へマスタの直しを反映した記録と、反映する直前の収支表の姿。
 *
 * 収支表は毎回まるごと作り直される作りなので、確定済みの月に作り直しを掛けると
 * 反映前の数字を復元する手段がどこにも残らない。配布済みの表と食い違ったときに
 * 戻せない状態では、反映ボタンを怖くて押せない。反映の直前に月まるごとを
 * JSONで1行に固めて残し、取り消しはこれを書き戻すだけで済むようにする。
 */
export const confirmedMonthApplyLog = sqliteTable(
  "confirmed_month_apply_log",
  {
    id: text("id").primaryKey(),
    yearMonth: text("year_month").notNull(),
    /** 画面に出す一言 (「4台の数字が変わりました」) */
    summary: text("summary").notNull(),
    /** 反映する直前の vehicle_pl 行 (JSON配列) */
    snapshotJson: text("snapshot_json").notNull(),
    appliedBy: text("applied_by").references(() => user.id, { onDelete: "set null" }),
    appliedByName: text("applied_by_name").notNull().default(""),
    appliedAt: integer("applied_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    /** 反映を取り消した時刻。NULL は「反映が生きている」 */
    revertedAt: integer("reverted_at", { mode: "timestamp_ms" }),
    revertedBy: text("reverted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [index("confirmed_month_apply_log_ym_idx").on(table.yearMonth, table.appliedAt)],
);

/**
 * 「前回と異なります」を出すための、前回時点の内容。
 *
 * 取込は既存のマスタを上書きしていくので、上書きした後では前回が残らない。
 * 突き合わせに使う項目だけを種類ごとに1行のJSONで持ち、次の取込時の相手にする。
 * 元データそのものの控えではなく、比較用の写しである点に注意。
 */
export const importCompareSnapshot = sqliteTable("import_compare_snapshot", {
  /** "vehicle" | "driver" | "rate" */
  targetKind: text("target_kind").primaryKey(),
  /** ComparableRecord[] のJSON */
  recordsJson: text("records_json").notNull(),
  capturedAt: integer("captured_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/**
 * 「確認済み」にしたアラート。
 *
 * 見て納得したものが毎回出続けると、次第に全部読まれなくなる。読まれないアラートは
 * 無いのと同じなので、確認済みにしたものは以後出さない。
 * 指紋(fingerprint)は対象・項目・変更前後の値から作るため、同じ箇所でも別の値に
 * 変わればまた出る。「一度OKした」が「以後ずっとOK」にはならない。
 */
export const importDiffAck = sqliteTable(
  "import_diff_ack",
  {
    fingerprint: text("fingerprint").primaryKey(),
    targetKind: text("target_kind").notNull(),
    targetLabel: text("target_label").notNull().default(""),
    /** 画面に出していた一言。後から「何をOKしたか」を辿るため */
    summary: text("summary").notNull().default(""),
    ackedBy: text("acked_by").references(() => user.id, { onDelete: "set null" }),
    ackedByName: text("acked_by_name").notNull().default(""),
    ackedAt: integer("acked_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("import_diff_ack_kind_idx").on(table.targetKind, table.ackedAt)],
);

/**
 * 表記のゆれとして自動で吸収した差分の控え。
 *
 * 画面には出さない。出すと本当に見るべきものが埋もれる。
 * ただし「勝手に同じものとして扱った」事実が残らないと、後から突合が合わない理由を
 * 追えなくなるので、裏側には必ず残す。
 */
export const importDiffAbsorbed = sqliteTable(
  "import_diff_absorbed",
  {
    id: text("id").primaryKey(),
    targetKind: text("target_kind").notNull(),
    targetKey: text("target_key").notNull(),
    targetLabel: text("target_label").notNull().default(""),
    field: text("field").notNull(),
    beforeValue: text("before_value").notNull().default(""),
    afterValue: text("after_value").notNull().default(""),
    absorbedAt: integer("absorbed_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("import_diff_absorbed_at_idx").on(table.absorbedAt)],
);

/**
 * 赤字車両(車番×年月)のAI要因分析結果。/deficit の「AI分析する」ボタンから
 * 月単位でバッチ生成し、ここに永続化して同月の再訪時はAIを再呼び出ししない(キャッシュ)。
 * factorsJson は DeficitFactorItem[] (科目名・向き・金額・説明) をJSON文字列で保持する。
 */
export const deficitFactorAnalysis = sqliteTable(
  "deficit_factor_analysis",
  {
    id: text("id").primaryKey(),
    yearMonth: text("year_month").notNull(),
    vehicleNo: text("vehicle_no").notNull(),
    summary: text("summary").notNull(),
    factorsJson: text("factors_json").notNull(),
    model: text("model").notNull(),
    /**
     * 分析した時点の損益(円)。現在の損益と突き合わせてキャッシュの陳腐化を判定する。
     * この列より前に作られたレコードは NULL で、判定不能=再分析対象として扱う。
     */
    profitAtAnalysis: real("profit_at_analysis"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedBy: text("updated_by").references(() => user.id),
  },
  (table) => [
    uniqueIndex("deficit_factor_analysis_ym_no_idx").on(table.yearMonth, table.vehicleNo),
  ],
);

/**
 * 各画面の右下から届く改善要望。
 *
 * 本文と画像を別のテーブルに分ける。画像は1件で数百KBあり、一覧を描くたびに
 * 引くと全件ぶんの画像を読むことになる。一覧は本文だけ、詳細を開いたときだけ
 * 画像を引く形にするため、最初から行を分けておく。
 *
 * routePattern は集計の単位 (/vehicle/[vehicleNo])。path は実URL。
 * 実URLだけで数えると同じ画面への指摘が車番の数だけ分かれるため、両方を持つ。
 */
export const improvementRequest = sqliteTable(
  "improvement_request",
  {
    /**
     * 投稿者 + 送信キーから決まる id。同じ内容を2回送っても同じ行になるので、
     * 通信が切れて押し直されたときに要望が2件並ばない。
     */
    id: text("id").primaryKey(),
    reporterId: text("reporter_id").references(() => user.id, { onDelete: "set null" }),
    /** 退職などで利用者が消えても「誰が言ったか」を残す。 */
    reporterName: text("reporter_name").notNull().default(""),
    /** 送信のたびにブラウザが作る鍵。再送を1件にまとめるために使う。 */
    submissionKey: text("submission_key").notNull(),
    path: text("path").notNull(),
    routePattern: text("route_pattern").notNull(),
    screenLabel: text("screen_label").notNull(),
    body: text("body").notNull(),
    /** 送ったときの画面の幅×高さ。「私の画面では崩れる」を再現するための手がかり。 */
    viewport: text("viewport"),
    userAgent: text("user_agent"),
    status: text("status").notNull().default("open"),
    handledById: text("handled_by_id").references(() => user.id, { onDelete: "set null" }),
    handledNote: text("handled_note"),
    handledAt: integer("handled_at", { mode: "timestamp_ms" }),
    /**
     * 「重複」にしたときの親。どの要望と同じ話なのかを必ず指させる。
     * 指し先が無い「重複」は、後から見た人には消されたのと変わらない。
     */
    duplicateOfId: text("duplicate_of_id"),
    /**
     * 廃棄した日時 (論理削除)。入っていれば一覧の既定表示から外れる。
     *
     * 状態 (status) と別の列にするのは、この2つが直交するため。
     * 「見送りにして廃棄」も「未対応のまま廃棄」もあり、状態に混ぜると
     * 戻すときに元が何だったか分からなくなる。
     */
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    archivedById: text("archived_by_id").references(() => user.id, { onDelete: "set null" }),
    /**
     * 直したときの確認依頼 (GitHub の Pull Request) の指し先。
     *
     * 状態が「レビュー待ち」「対応済み」でも、どの修正のことか辿れないと
     * 「本当に直ったのか」を管理画面だけでは確かめられない。番号と URL を両方持つのは、
     * 画面には短い番号を出し、リンク先は URL をそのまま使うため。
     */
    prUrl: text("pr_url"),
    prNumber: integer("pr_number"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("improvement_request_created_idx").on(table.createdAt),
    index("improvement_request_status_idx").on(table.status, table.createdAt),
    index("improvement_request_route_idx").on(table.routePattern, table.createdAt),
    index("improvement_request_archived_idx").on(table.archivedAt),
    // 並んで届いた再送も1件に収める最後の砦 (id の一致だけに頼らない)
    uniqueIndex("improvement_request_submission_idx").on(table.reporterId, table.submissionKey),
  ],
);

/**
 * 改善要望から発行した、Claude Code 向けの指示文。
 *
 * 主キーを request_id にしてあるのが肝心なところ。「1つの要望に指示文は1つ」を
 * アプリのロジックではなく DB が保証する。同時に2回押されても、2行目は入らない。
 * 発行の権利 (publishing_at) もこの行で取るので、権利の取り合いも同じ表で決まる。
 *
 * 要望を完全削除すると、この行も一緒に消える (cascade)。指示文はアプリの中にしか
 * 無いので、消してくれと言われたら本当に消せる。
 */
export const improvementInstruction = sqliteTable(
  "improvement_instruction",
  {
    requestId: text("request_id")
      .primaryKey()
      .references(() => improvementRequest.id, { onDelete: "cascade" }),
    /** 何版目か。内容が変わったときだけ上がる (同じ内容で押しても上がらない)。 */
    version: integer("version").notNull().default(0),
    /**
     * 発行した内容の指紋 (見出し + 本文の SHA-256)。
     * 一括発行で何度押されても、これが一致する件は何もしない。
     */
    hash: text("hash"),
    /** published / fetched (Claude Code が取りに来た) / withdrawn (取り下げ)。 */
    state: text("state").notNull().default("published"),
    /**
     * 最後に発行した時点の値 (状況・対応メモなど) の控え。
     * 指紋だけでは「変わった」ことしか分からず、何が変わったかを書けない。
     */
    syncedFields: text("synced_fields"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    publishedById: text("published_by_id").references(() => user.id, { onDelete: "set null" }),
    /**
     * 発行の作業中を示す印 (取りかかった時刻)。
     * 途中で落ちても、一定時間で自然に空く (取りかかった時刻で判断する)。
     */
    publishingAt: integer("publishing_at", { mode: "timestamp_ms" }),
    /** Claude Code が最後に読み取った時刻。 */
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }),
    fetchCount: integer("fetch_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("improvement_instruction_state_idx").on(table.state, table.publishedAt)],
);

/**
 * 指示文を読むための鍵。
 *
 * 平文は保存しない (token_hash だけ)。DB を読める人が鍵を使えてはいけないため。
 * 範囲 (scope_ids) と期限 (expires_at) を必ず持たせる。「全部をいつまでも読める鍵」を
 * 配ると、渡した先の管理がこちらの手を離れる。
 */
export const improvementAccessToken = sqliteTable(
  "improvement_access_token",
  {
    id: text("id").primaryKey(),
    /** 何のために発行したか (画面に出す覚え書き)。 */
    name: text("name").notNull().default(""),
    tokenHash: text("token_hash").notNull().unique(),
    /** 開けてよい要望の id (JSON配列)。空配列なら発行済みのすべて。 */
    scopeIds: text("scope_ids").notNull().default("[]"),
    /**
     * できること (JSON配列)。read / status:own / status:any の3つだけ。
     * 既定を read だけにしてあるので、この列が入る前に発行された鍵は
     * これまでどおり「読むだけ」になる (足した列で権限が増えない)。
     */
    abilities: text("abilities").notNull().default('["read"]'),
    /**
     * この鍵が属する会社の id。単一の会社しか扱っていないいまは必ず null。
     *
     * マルチテナントにするときに会社IDを焼き込むのは **ここ1点**。
     * 発行時にセッションの会社IDを入れ、参照側は tokenCompanyRejection() で弾く
     * (呼ぶ場所は instructionAccess.ts に用意済み)。
     */
    companyId: text("company_id"),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    revokedReason: text("revoked_reason"),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    useCount: integer("use_count").notNull().default(0),
  },
  (table) => [index("improvement_access_token_expires_idx").on(table.expiresAt)],
);

/**
 * その鍵が、どの要望の指示文を実際に読み取ったか。
 *
 * 「自分が取得した要望だけ状態を進められる」を、権限の文字列ではなく事実で決めるための表。
 * 読んだ記録が無ければ状態を動かせないので、鍵の力の範囲が
 * 「実際にやった仕事」と自動的に一致する。
 *
 * request_id に外部キーを張らないのは improvement_audit と同じ理由で、
 * 要望を完全削除したあとも「その鍵が何を読んだか」を数えられるようにするため。
 */
export const improvementTokenClaim = sqliteTable(
  "improvement_token_claim",
  {
    tokenId: text("token_id").notNull(),
    requestId: text("request_id").notNull(),
    claimedAt: integer("claimed_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tokenId, table.requestId] }),
    index("improvement_token_claim_request_idx").on(table.requestId),
  ],
);

/**
 * 改善要望に自動で付く診断情報 (ブラウザの控え + サーバで足した分)。
 *
 * 本文と別の表にするのは、一覧で読まないため。診断情報は1件あたり数十KBあり、
 * 一覧で全件読むと件数が増えるほど管理画面が開かなくなる。
 * JSON のまま持つのは、集める項目が今後増えても表を作り直さずに済むから
 * (この中身で検索・集計する予定は無い)。
 */
export const improvementDiagnostics = sqliteTable("improvement_diagnostics", {
  requestId: text("request_id")
    .primaryKey()
    .references(() => improvementRequest.id, { onDelete: "cascade" }),
  payload: text("payload").notNull(),
  bytes: integer("bytes").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/**
 * 改善要望に対して行った操作の記録 (状態変更・廃棄・完全削除)。
 *
 * request_id に外部キーを張らない。張ると完全削除でこの行まで一緒に消え、
 * 「いつ誰が何をなぜ消したか」が残らなくなる。消した記録が消えるのでは監査にならない。
 */
export const improvementAudit = sqliteTable(
  "improvement_audit",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    actorId: text("actor_id"),
    /** 退職などで利用者が消えても「誰がやったか」を残す。 */
    actorName: text("actor_name").notNull().default(""),
    /**
     * status_change / archive / restore / purge /
     * instruction_publish / instruction_revise / instruction_withdraw / instruction_fetch /
     * token_issue / token_revoke
     */
    action: text("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    reason: text("reason"),
    at: integer("at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("improvement_audit_request_idx").on(table.requestId, table.at),
    index("improvement_audit_at_idx").on(table.at),
  ],
);

/** 改善要望に添えられた画面の写し (注釈・黒塗りを焼き込んだ後の1枚)。 */
export const improvementShot = sqliteTable("improvement_shot", {
  requestId: text("request_id")
    .primaryKey()
    .references(() => improvementRequest.id, { onDelete: "cascade" }),
  /** data URL のまま持つ。R2 を挟むと本文と画像で保存先が分かれ、片方だけ残る事故が起きる。 */
  dataUrl: text("data_url").notNull(),
  bytes: integer("bytes").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});
