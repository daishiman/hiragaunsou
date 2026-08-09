/**
 * 業務フロー STEP1〜8 の実データ通し検証。
 *
 * 実データ (data/) は個人情報・取引情報を含むため Git 管理外 (.gitignore の /data/)。
 * ファイルが無い環境では自動でスキップし、CI を壊さない。
 *
 * 検証の考え方:
 *   - STEP1/2/4 の入力は実CSVをそのまま流す (ここが「業務が回るか」の本体)
 *   - STEP3/5/6 は請求書からの人手入力でCSVソースが無いため、正解Excelの該当列を入力として与える
 *   - マスタ (リース料・保険・税・社員コード紐付け) とレートも正解Excelから復元する
 *   - そのうえで STEP7 の計算結果を正解Excel「5月収支表」の全列と突き合わせる
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseMonthlyPlWorkbook } from "../../src/infrastructure/parsers/monthlyPlWorkbookParser";
import { parseVehicleOperationCsv } from "../../src/infrastructure/parsers/vehicleOperationParser";
import {
  parseSalesMonitorCsv,
  aggregateSalesByVehicle,
  slipKey,
} from "../../src/infrastructure/parsers/salesMonitorParser";
import { parsePayrollCsv } from "../../src/infrastructure/parsers/payrollParser";
import { detectCleansingFlags, needsHumanDecision } from "../../src/domain/rules/cleansingRules";
import { allocateKirinSupport } from "../../src/domain/rules/kirinAllocation";
import { FinalizeMonthlyPlUseCase, type ManualVehicleInput } from "../../src/usecase/steps/finalizeMonthlyPl";
import { ConfirmMonthlyPlUseCase } from "../../src/usecase/steps/confirmMonthlyPl";
import { buildMonthlyPlCsv } from "../../src/usecase/steps/exportMonthlyPlCsv";
import { stubReviewFlagRepo } from "../fixtures/stubRepositories";
import type { VehiclePlCalculated } from "../../src/domain/rules/vehiclePlCalculation";
import type {
  DriverMasterRepository,
  RateMasterRepository,
  VehicleMasterRecord,
  VehicleMasterRepository,
} from "../../src/domain/repositories/MasterRepository";
import type { ImportBatchRepository, VehiclePlRepository } from "../../src/domain/repositories/VehiclePlRepository";
import { DEFAULT_DEFICIT_THRESHOLDS } from "../../src/domain/rules/deficitClassification";

const YM = "2026-05";
const DATA = {
  workbook: "data/★車両別収支計算用2026年5月.xlsx",
  annual: "data/運送収支表 2025-2026 5月更新.xlsx",
  operation: "data/車両別運行実績表（燃費計算）本社.csv",
  sales: "data/2026年5月売上モニタリスト.csv",
  payroll: "data/5給与集計表（日給者）.csv",
};

const hasRealData = Object.values(DATA).every((p) => existsSync(p));

/** Excelの稼働時間はシリアル値(1日=1)で保存されているため時間に直す。 */
const HOURS_PER_DAY = 24;
/** 金額の突合許容差。Excelの浮動小数・表示丸めを吸収する。 */
const YEN_TOLERANCE = 1;

/**
 * 正解Excelとの不一致件数の上限 (2026-08-08 実測 151件)。
 *
 * 突合結果を目視レポートに出すだけで誰も検証していなかったため、一般管理費率が
 * 0.169 のまま (実運用は 0.1748) でもこのテストは緑のままだった。件数を固定して
 * 初めて突合が品質の計器になる。
 *
 * 現在の内訳。すべて率とは無関係な既知差で、率が狂うとここに 362件 上乗せされる:
 *   稼働時間26 / 稼働Km26 / 運行回数25 / 燃費24 … 運行実績CSVと集計単位の既知差
 *   運送収入6 / 一般管理費6 / 変動費9 / 経費計9 / 損益9 … 上記の運送収入差に連動
 *   運賃5 / 賞与3 / 人件費計3 … Excel側の手作業修正
 * 減った分には追随してよい (この値を下げる方向の更新は歓迎)。
 */
const MAX_MISMATCH_ITEMS = 151;

describe.skipIf(!hasRealData)("業務フロー STEP1〜8 実データ通し検証 (2026-05)", () => {
  // describe.skipIf はテストの実行だけを飛ばし、コールバック本体は収集時に必ず評価される。
  // ここで readFileSync すると実データの無い環境 (CI) で suite ごと ENOENT で落ちるため、
  // 読み込みは beforeAll に置く (スキップ時はフックも走らない)。
  let expectedRows: ReturnType<typeof parseMonthlyPlWorkbook>["rows"];
  let expectedByNo: Map<string, VehiclePlCalculated>;
  let operations: ReturnType<typeof parseVehicleOperationCsv>;
  let salesRows: ReturnType<typeof parseSalesMonitorCsv>;
  let payrolls: ReturnType<typeof parsePayrollCsv>;

  beforeAll(() => {
    expectedRows = parseMonthlyPlWorkbook(readFileSync(DATA.workbook), YM).rows;
    expectedByNo = new Map(expectedRows.map((r) => [r.no, r]));
    operations = parseVehicleOperationCsv(readFileSync(DATA.operation));
    salesRows = parseSalesMonitorCsv(readFileSync(DATA.sales));
    payrolls = parsePayrollCsv(readFileSync(DATA.payroll));
  });

  it("STEP1: 運行実績CSVを取り込み、傭車(88888)を自動除外し、要確認行を人の判断に回す", () => {
    expect(operations.length).toBeGreaterThan(0);
    // 傭車は機械的に自動除外してよい(判断を人に出さない)
    expect(operations.filter((o) => o.isChartered).every((o) => o.vehicleCode === "88888")).toBe(true);

    const flagged = salesRows.map((row) => ({
      row,
      flags: detectCleansingFlags({ vehicleNo: row.vehicleCode, driverName: row.driverName }),
    }));
    const chartered = flagged.filter((f) => f.flags.some((x) => x.type === "chartered"));
    const review = flagged.filter((f) => needsHumanDecision(f.flags));

    // 傭車は自動除外側、888/10/5000・諸口は人の判断側に分かれること
    expect(chartered.every((f) => !needsHumanDecision(f.flags))).toBe(true);
    expect(review.length).toBeGreaterThan(0);
    for (const f of review) {
      const types = f.flags.map((x) => x.type);
      const isSuspectNo = ["888", "10", "5000"].includes(f.row.vehicleCode);
      const isMisc = f.row.driverName === "諸口";
      expect(isSuspectNo || isMisc).toBe(true);
      expect(types.some((t) => t === "duplicate_suspect" || t === "misc_entry")).toBe(true);
    }

    // 伝票の自然キー(管理№+行№)が全行で一意に取れること = 判断を再取込後も引き継げる
    const keys = salesRows.map((row, i) => slipKey(row, i));
    expect(new Set(keys).size).toBe(keys.length);

    console.log(
      `[STEP1] 運行実績 ${operations.length}台 / 売上伝票 ${salesRows.length}行 ` +
        `(傭車自動除外 ${chartered.length}行 / 要確認 ${review.length}行)`,
    );
  });

  it("STEP2: 売上モニタリストを車番別に集計し、キリン協力金を24番・300番へ等分配賦する", () => {
    const agg = aggregateSalesByVehicle(salesRows);
    expect(agg.size).toBeGreaterThan(0);
    // 傭車は集計に含めない
    expect(agg.has("88888")).toBe(false);

    const allocations = allocateKirinSupport({ transportSupport: 300_000, managementSupport: 200_000 });
    expect(allocations.map((a) => a.vehicleNo)).toEqual(["24", "300"]);
    expect(allocations.reduce((s, a) => s + a.amount, 0)).toBe(500_000);
    expect(allocations[0]!.amount).toBe(250_000);

    console.log(`[STEP2] 売上集計 ${agg.size}台`);
  });

  it("STEP4: 給与集計表CSVを取り込み、社員コードで運転者マスタに紐づく", () => {
    expect(payrolls.length).toBeGreaterThan(0);
    const codes = new Set(payrolls.map((p) => p.employeeCode));
    const linked = expectedRows
      .flatMap((r) => (r.code ?? "").split("/"))
      .map((c) => c.trim())
      .filter((c) => c !== "")
      .filter((c) => codes.has(c));
    expect(linked.length).toBeGreaterThan(0);
    console.log(`[STEP4] 給与 ${payrolls.length}名 / 収支表の社員コードと一致 ${linked.length}件`);
  });

  it("STEP7→8: 実データで収支を確定し、正解Excelの5月収支表と全列を突き合わせる", async () => {
    const actual = await runFinalize();
    const report = reconcile(actual, expectedByNo);
    console.log(report.text);

    // 突合結果を出すだけでなく判定する。件数が増えたら計算のどこかが劣化している。
    expect(report.mismatches.length).toBeLessThanOrEqual(MAX_MISMATCH_ITEMS);

    // 収支表に載る全車両分の行が生成されること
    expect(actual.length).toBe(expectedRows.length);

    // STEP8: 確定と書き出しが通ること
    const plRepo = stubPlRepo({ [YM]: actual });
    const confirmed = await new ConfirmMonthlyPlUseCase(plRepo, stubReviewFlagRepo([])).execute(YM, true);
    expect(confirmed.isConfirmed).toBe(true);

    const csv = buildMonthlyPlCsv(
      actual.map((row) => ({ vehicleNo: row.no, values: row as unknown as Record<string, number | string | null> })),
    );
    // ヘッダー1行 + 車両行、末尾のCRLFで1要素余る
    expect(csv.trimEnd().split("\r\n").length).toBe(actual.length + 1);
  });

  // ---- 以下、上のテストが使う組み立て --------------------------------------

  async function runFinalize(): Promise<VehiclePlCalculated[]> {
    const vehicles: VehicleMasterRecord[] = expectedRows.map((r) => ({
      vehicleNo: r.no,
      vehicleType: r.type,
      depot: r.depot,
      regDate: r.reg,
      costCategory: "medium",
      insCompulsory: r.insCompulsory,
      insVoluntary: r.insVoluntary,
      taxAuto: r.taxAuto,
      taxWeight: r.taxWeight,
      lease: r.lease,
      installment: r.installment,
    }));

    const drivers = expectedRows.flatMap((r) => {
      // 運転者名が空の行の E列は社員コードではない(部門番号等)ので運転者として扱わない
      const names = (r.driver ?? "").split("/").map((c) => c.trim()).filter((c) => c !== "");
      if (names.length === 0) return [];
      const codes = (r.code ?? "").split("/").map((c) => c.trim()).filter((c) => c !== "");
      return codes.map((code, i) => ({
        employeeCode: code,
        driverName: names[i] ?? names[0] ?? "",
        vehicleNo: r.no as string | null,
      }));
    });

    // STEP3/5/6 は請求書からの人手入力。CSVソースが無いため正解Excelの該当列を入力として与える。
    // メンテ列(AB)には実データ上「修理費+タイヤ費+備品費」の合計が入っているため、
    // 二重計上しないよう mainte=0 とする (下の reconcile で expected.mainte と突き合わせる)。
    const manualInputs: ManualVehicleInput[] = expectedRows.map((r) => ({
      vehicleNo: r.no,
      fuelInQty: r.fuelInQty,
      fuelOut: r.fuelOut,
      fuelOutQty: r.fuelOutQty,
      adblue: r.adblue,
      repairActual: r.repair,
      tireActual: r.tire,
      equip: r.equip,
      // Excelの入力が不統一: ※修繕費計(AC)が空の行では、メンテ列(AB)に修繕費計が入っている。
      // AC が埋まっている行だけ AB を本物のメンテ委託費として扱う。
      mainte: r.repairTotal > 0 ? r.mainte : 0,
      tollActual: r.toll,
      tollDiscountActual: r.tollDisc,
      miscOther: r.miscOther,
    }));

    const opRows = operations.map((op, i) => ({
      rowIndex: i,
      naturalKey: op.vehicleCode,
      raw: op as unknown,
      flags: [] as string[],
    }));
    const salesRaw = salesRows.map((row, i) => ({
      rowIndex: i,
      naturalKey: slipKey(row, i),
      raw: row as unknown,
      flags: [] as string[],
    }));
    const payrollRaw = payrolls.map((p, i) => ({
      rowIndex: i,
      naturalKey: p.employeeCode,
      raw: p as unknown,
      flags: [] as string[],
    }));

    const importBatchRepo = {
      findRawRows: async (_ym: string, sourceType: string) =>
        sourceType === "vehicle_operation" ? opRows : sourceType === "sales_monitor" ? salesRaw : payrollRaw,
      // 収支表は取込のある月にしか作らない。実データを流すこのテストは取込済みの月にあたる。
      findLatestBatch: async () => ({
        id: "batch-1",
        fileName: "a.csv",
        rowCount: 1,
        excludedRowCount: 0,
        importedAt: 0,
        status: "done",
      }),
    } as unknown as ImportBatchRepository;

    const result = await new FinalizeMonthlyPlUseCase(
      importBatchRepo,
      { findAllActive: async () => vehicles } as VehicleMasterRepository,
      { findAll: async () => drivers } as DriverMasterRepository,
      excelDerivedRates(),
      stubPlRepo({}),
    ).execute({
      yearMonth: YM,
      manualInputs,
      // STEP2の人手入力。金額の出所は正解Excelの「車両別売上」シート右側(キリン 輸送協力金/経営支援金)。
      kirinAllocations: allocateKirinSupport({ transportSupport: 198_932, managementSupport: 105_322 }),
    });

    return result.rows;
  }

  /** 正解Excelが実際に使っている一般管理費率。運送収入と一般管理費から逆算する。 */
  function excelAdminFeeRate(): number {
    const adminRow = expectedRows.find((r) => r.sales > 0 && r.adminFee > 0)!;
    return +(adminRow.adminFee / adminRow.sales).toFixed(6);
  }

  /** 正解Excelから逆算したレート (ハードコードせずデータから derive する) */
  function excelDerivedRates(): RateMasterRepository {
    const tankRow = expectedRows.find((r) => r.fuelInQty > 0 && r.fuelIn > 0)!;
    const bonusRow = expectedRows.find((r) => r.bonus > 0)!;
    return {
      getRates: async () => ({
        tollDiscountRate: 0.356,
        adminFeeRate: excelAdminFeeRate(),
        bonusAnnual: bonusRow.bonus * 12,
        tankPricePerLiter: +(tankRow.fuelIn / tankRow.fuelInQty).toFixed(4),
      }),
      getDeficitThresholds: async () => DEFAULT_DEFICIT_THRESHOLDS,
      setRate: async () => {},
    };
  }

  /**
   * レート設定の齟齬検出。
   *
   * 上の突合はレートを正解Excelから逆算して使うため、システムが本番で使う率が
   * 何であっても常に一致してしまう。実際これが理由で、一般管理費率が実運用 17.48% に
   * 対しシステム側 16.9% という齟齬が検出されないまま残っていた。
   * 「Excelが使っている率」と「システムが使う率」を突き合わせるのはここの責任。
   */
  it("正解Excelの一般管理費率と、システムが本番で使う率が一致する", () => {
    const excelRate = excelAdminFeeRate();
    const seededRate = seededAdminFeeRate();

    // 比較先を DEFAULT_RATE_SETTINGS ではなくシードSQLにしているのは、既定値が
    // 「マスタに行が無いときの保険」であって本番の実効値ではないため。
    // 保険値と突き合わせても、本番で実際に使われる率が正しいことの保証にならない。
    expect(
      seededRate,
      `正解Excelの一般管理費率 ${excelRate} と、rate_master にシードした率 ${seededRate} が食い違っています。\n` +
        "Excel側で率が改定されたのなら migrations に新しいシードを追加してください " +
        "(0015 を書き換えると適用済み環境に反映されません)。\n" +
        "Excel側の事故を疑うなら、その月の一般管理費列が運送収入×率になっているかを先に確認してください " +
        "(2025年9月は8月からの値貼り付けが更新漏れになっていた実績があります)。",
    ).toBeCloseTo(excelRate, 6);
  });

  /**
   * rate_master に投入されている一般管理費率。本番の実効値そのもの。
   * 定数として持つと「シードSQLとテストの両方を直す」必要が生まれ、片方だけ直した
   * 瞬間に齟齬が生まれる。齟齬を検出するためのテストが齟齬の発生源になっては意味がない。
   */
  function seededAdminFeeRate(): number {
    const sql = readFileSync("migrations/0015_seed_rate_master.sql", "utf8");
    const matched = /'admin_fee_rate',\s*NULL,\s*([0-9.]+)/.exec(sql);
    if (!matched) {
      throw new Error(
        "migrations/0015_seed_rate_master.sql から admin_fee_rate のシード値を読めませんでした。" +
          "シードの書き方を変えたなら、この抽出も合わせて直してください。",
      );
    }
    return Number(matched[1]);
  }
});

function stubPlRepo(store: Record<string, VehiclePlCalculated[]>): VehiclePlRepository {
  const confirmed = new Set<string>();
  return {
    upsertMany: async (ym, rows) => {
      store[ym] = rows;
    },
    removeVehicles: async (ym, vehicleNos) => {
      const drop = new Set(vehicleNos);
      store[ym] = (store[ym] ?? []).filter((r) => !drop.has(r.no));
    },
    findByYearMonth: async (ym) => store[ym] ?? [],
    findByVehicleNo: async (no) => Object.values(store).flat().filter((r) => r.no === no),
    findByYearMonths: async (yms) => new Map(yms.map((ym) => [ym, store[ym] ?? []])),
    countByYearMonth: async (ym) => (store[ym] ?? []).length,
    getConfirmation: async (ym) => ({
      total: (store[ym] ?? []).length,
      confirmed: confirmed.has(ym) ? (store[ym] ?? []).length : 0,
    }),
    setConfirmed: async (ym, value) => {
      if (value) confirmed.add(ym);
      else confirmed.delete(ym);
    },
  };
}

/** 突合対象の列。expected 側の読み替えが要る列だけ変換関数を持たせる。 */
const COMPARISONS: { field: string; label: string; expectedOf: (r: VehiclePlCalculated) => number; actualOf: (r: VehiclePlCalculated) => number }[] = [
  { field: "trips", label: "運行回数", expectedOf: (r) => r.trips, actualOf: (r) => r.trips },
  { field: "hours", label: "稼働時間", expectedOf: (r) => r.hours * HOURS_PER_DAY, actualOf: (r) => r.hours },
  { field: "km", label: "稼働Km", expectedOf: (r) => r.km, actualOf: (r) => r.km },
  { field: "slips", label: "伝票件数", expectedOf: (r) => r.slips, actualOf: (r) => r.slips },
  { field: "fare", label: "運賃", expectedOf: (r) => r.fare, actualOf: (r) => r.fare },
  { field: "fee", label: "附帯料金", expectedOf: (r) => r.fee, actualOf: (r) => r.fee },
  { field: "sales", label: "運送収入", expectedOf: (r) => r.sales, actualOf: (r) => r.sales },
  { field: "toll", label: "道路使用料", expectedOf: (r) => r.toll, actualOf: (r) => r.toll },
  { field: "tollNet", label: "運行費計", expectedOf: (r) => r.tollNet, actualOf: (r) => r.tollNet },
  { field: "fuelIn", label: "軽油代インタンク", expectedOf: (r) => r.fuelIn, actualOf: (r) => r.fuelIn },
  { field: "fuelTotal", label: "燃料費計", expectedOf: (r) => r.fuelTotal, actualOf: (r) => r.fuelTotal },
  { field: "nempi", label: "燃費", expectedOf: (r) => r.nempi, actualOf: (r) => r.nempi },
  // Excelは※修繕費計(AC)が空の行ではメンテ列(AB)に計が入っている
  { field: "repairTotal", label: "修繕費計", expectedOf: (r) => (r.repairTotal > 0 ? r.repairTotal : r.mainte), actualOf: (r) => r.repairTotal },
  { field: "salary", label: "給与", expectedOf: (r) => r.salary, actualOf: (r) => r.salary },
  { field: "welfare", label: "福利厚生費", expectedOf: (r) => r.welfare, actualOf: (r) => r.welfare },
  { field: "bonus", label: "賞与", expectedOf: (r) => r.bonus, actualOf: (r) => r.bonus },
  { field: "laborTotal", label: "人件費計", expectedOf: (r) => r.laborTotal, actualOf: (r) => r.laborTotal },
  { field: "insTotal", label: "保険料計", expectedOf: (r) => r.insTotal, actualOf: (r) => r.insTotal },
  { field: "taxTotal", label: "賦課税計", expectedOf: (r) => r.taxTotal, actualOf: (r) => r.taxTotal },
  { field: "transportTotal", label: "運送費計", expectedOf: (r) => r.transportTotal, actualOf: (r) => r.transportTotal },
  { field: "adminFee", label: "一般管理費", expectedOf: (r) => r.adminFee, actualOf: (r) => r.adminFee },
  { field: "fixed", label: "固定費", expectedOf: (r) => r.fixed, actualOf: (r) => r.fixed },
  { field: "variable", label: "変動費", expectedOf: (r) => r.variable, actualOf: (r) => r.variable },
  { field: "expense", label: "経費計", expectedOf: (r) => r.expense, actualOf: (r) => r.expense },
  { field: "profit", label: "損益", expectedOf: (r) => r.profit, actualOf: (r) => r.profit },
];

interface Mismatch {
  no: string;
  label: string;
  expected: number;
  actual: number;
  diff: number;
}

function reconcile(actual: VehiclePlCalculated[], expected: Map<string, VehiclePlCalculated>) {
  const lines: string[] = ["", "=== 正解Excel「5月収支表」との突合 (2026-05) ==="];
  lines.push("列名\t一致\t不一致\t不一致合計額(円)\t最大差の車番");
  const mismatches: Mismatch[] = [];
  for (const cmp of COMPARISONS) {
    let ok = 0;
    let ng = 0;
    let sum = 0;
    let worst = { no: "-", diff: 0 };
    for (const row of actual) {
      const exp = expected.get(row.no);
      if (!exp) continue;
      const expectedValue = cmp.expectedOf(exp);
      const actualValue = cmp.actualOf(row);
      const diff = actualValue - expectedValue;
      if (Math.abs(diff) <= (cmp.field === "nempi" ? 0.01 : YEN_TOLERANCE)) {
        ok += 1;
      } else {
        ng += 1;
        sum += diff;
        mismatches.push({ no: row.no, label: cmp.label, expected: expectedValue, actual: actualValue, diff });
        if (Math.abs(diff) > Math.abs(worst.diff)) worst = { no: row.no, diff };
      }
    }
    lines.push(
      `${cmp.label}\t${ok}\t${ng}\t${Math.round(sum).toLocaleString("ja-JP")}\t${worst.no}(${Math.round(worst.diff).toLocaleString("ja-JP")})`,
    );
  }

  const totalExpected = [...expected.values()].reduce((s, r) => s + r.profit, 0);
  const totalActual = actual.reduce((s, r) => s + r.profit, 0);
  lines.push(
    `\n全社損益: 正解Excel ${Math.round(totalExpected).toLocaleString("ja-JP")}円 / システム ${Math.round(totalActual).toLocaleString("ja-JP")}円 ` +
      `(差 ${Math.round(totalActual - totalExpected).toLocaleString("ja-JP")}円)`,
  );

  lines.push(buildMismatchDetail(mismatches));
  return { text: lines.join("\n"), mismatches };
}

/**
 * 車番×項目の食い違い一覧。
 * Excel側の手作業ミス・不整合にはシステムを合わせない方針のため、
 * 「どの車番のどの項目がいくら違うか」を利用者が確認できる形で必ず出す。
 * RECONCILE_OUT にパスを与えるとTSVとしても書き出す (既定は標準出力のみ)。
 */
function buildMismatchDetail(mismatches: Mismatch[]): string {
  const header = "車番\t項目\tExcel\tシステム\t差";
  const byVehicle = new Map<string, Mismatch[]>();
  for (const m of mismatches) {
    const list = byVehicle.get(m.no) ?? [];
    list.push(m);
    byVehicle.set(m.no, list);
  }
  // 影響額の大きい車両から並べる (直すべき順に読める)
  const ordered = [...byVehicle.entries()].sort(
    (a, b) => impactOf(b[1]) - impactOf(a[1]),
  );

  const rows = ordered.flatMap(([, list]) =>
    list.map((m) => [m.no, m.label, fmt(m.expected), fmt(m.actual), fmt(m.diff)].join("\t")),
  );

  const outPath = process.env.RECONCILE_OUT;
  if (outPath) writeFileSync(outPath, [header, ...rows].join("\n") + "\n", "utf8");

  return [
    "",
    `=== 車番別の食い違い一覧 (${byVehicle.size}台 / ${mismatches.length}項目) ===`,
    header,
    ...rows,
  ].join("\n");
}

function impactOf(list: Mismatch[]): number {
  return list.reduce((s, m) => s + Math.abs(m.diff), 0);
}

function fmt(value: number): string {
  return (Math.round(value * 100) / 100).toLocaleString("ja-JP");
}
