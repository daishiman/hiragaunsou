import { test, expect } from "@playwright/test";
import Encoding from "encoding-japanese";
import { getPlatformProxy } from "wrangler";
import {
  clearRateLimits,
  createTestUser,
  deleteTestUserByEmail,
  withBusyRetry,
} from "./helpers/testUsers";
import { getSessionCookie, injectSessionCookie } from "./helpers/loginAs";

test.describe.configure({ mode: "serial" });

/**
 * 締め作業の通し確認: 取込 → データ整形 → 手入力 → チェック → 確定 → 月次収支表 → 年間集計。
 *
 * 依頼者から出た「4つ取り込んだのに、整形・手入力・年間集計に反映されない」は、
 * 1つ1つの処理が正しくても工程の受け渡しが切れていれば起きる。
 * tests/acceptance/realDataWorkflow.test.ts は同じ流れを追っているが、
 * リポジトリをスタブに差し替えているためDBも画面も通らず、
 * 「画面が別の月を見ている」「取込はあるのに収支表が作られない」といった
 * 受け渡しの断絶を1つも検出できなかった。
 *
 * そこでこのファイルだけは、ローカルD1に対して実際の画面を操作して通す。
 * どこか1工程でも次へつながらなくなったら、ここが落ちる。
 *
 * 実行方法(Workersランタイムを立ててから当てる):
 *   pnpm run preview                       # http://localhost:8787
 *   E2E_BASE_URL=http://localhost:8787 pnpm exec playwright test tests/e2e/monthly-close-chain.spec.ts
 * 既定の :3000 (next dev) に当てるとログインが「Invalid origin」で 403 になる
 * (.dev.vars の BETTER_AUTH_URL が :8787 のため)。
 */

/**
 * 通し確認専用の月。
 * ローカルには実データ(2026-05〜2026-08)が入っており、そこへ書くと引き渡し用の状態を壊す。
 * 実データが1件も無く、かつ画面の年月プルダウン(過去25ヶ月)に含まれる月を選ぶ。
 */
const YEAR_MONTH = "2025-11";
const YEAR_MONTH_LABEL = "2025年11月";
const VEHICLE_NOS = ["9301", "9302"] as const;
const EMPLOYEE_CODES = ["E9301", "E9302"] as const;
/** 9301番の通行料。売上モニタリスト → 収支表 → 手入力の自動計算値、とつながることの目印にする。 */
const TOLL_9301 = 12000;

const OPERATION_FILE = "E2E車両別運行実績表.csv";
const SALES_FILE = "E2E売上モニタリスト.csv";

/** パーサはcp932前提なので、テスト側のCSVも同じ文字コードで作る。 */
function encodeCp932(text: string): Buffer {
  return Buffer.from(
    Encoding.convert(Encoding.stringToCode(text), { to: "SJIS", from: "UNICODE" }),
  );
}

/** 車両別運行実績表(日付列を持たないので、取込時に年月を尋ねられる帳票)。 */
function buildOperationCsv(): Buffer {
  const header =
    '"車両番号","車両名称","所属名称","車種","稼動回数","稼動時間","総距離","総給油量（L）","燃費（km/L）"';
  const rows = [
    `"${VEHICLE_NOS[0]}","E2E車両1","本社","大型","20","174:59","6000.00","1500.00","4.0"`,
    `"${VEHICLE_NOS[1]}","E2E車両2","本社","大型","18","150:00","4000.00","1000.00","4.0"`,
  ];
  return encodeCp932([header, ...rows].join("\r\n"));
}

/**
 * 売上モニタリスト。積荷日から年月が判定できるので、取込時に確認は入らない。
 * 運転者名「諸口」の行を1件混ぜ、データ整形(STEP2)に判断待ちが出ることまで見る。
 */
function buildSalesCsv(): Buffer {
  const header =
    '"車両コード","運転者名","受取運賃","通行料","燃料サーチャージ","待機時間料","付帯料金","管理№","行№","荷主先略称","積荷日"';
  const rows = [
    `"${VEHICLE_NOS[0]}","E2E運転者1","500,000","${TOLL_9301}","0","0","0","E2E0001","1","E2E荷主","2025/11/05"`,
    `"${VEHICLE_NOS[1]}","E2E運転者2","300,000","7,000","0","0","0","E2E0002","1","E2E荷主","2025/11/06"`,
    `"${VEHICLE_NOS[0]}","諸口","10,000","0","0","0","0","E2E0003","1","E2E荷主","2025/11/07"`,
  ];
  return encodeCp932([header, ...rows].join("\r\n"));
}

const OPERATION_CSV = buildOperationCsv();
const SALES_CSV = buildSalesCsv();

async function withLocalDb<T>(run: (db: D1Database) => Promise<T>): Promise<T> {
  const proxy = await getPlatformProxy();
  try {
    return await withBusyRetry(() => run((proxy.env as unknown as { DB: D1Database }).DB));
  } finally {
    await proxy.dispose();
  }
}

/** 収支表の行は車両マスタから作られるので、通しを始める前に対象の2台を用意しておく。 */
async function seedVehicleMaster(): Promise<void> {
  await withLocalDb(async (DB) => {
    await DB.batch([
      ...VEHICLE_NOS.map((no) =>
        DB.prepare(
          "INSERT INTO vehicle_master (vehicle_no, vehicle_type, depot, cost_category, active) VALUES (?, '大型', '本社', 'large', 1)",
        ).bind(no),
      ),
      ...EMPLOYEE_CODES.map((code, i) =>
        DB.prepare(
          "INSERT INTO driver_master (employee_code, driver_name, vehicle_no) VALUES (?, ?, ?)",
        ).bind(code, `E2E運転者${i + 1}`, VEHICLE_NOS[i]),
      ),
    ]);
  });
}

/**
 * 通しで作られたものを消す。対象月はこのテスト専用なので年月で丸ごと落とせる。
 * 車両マスタ・運転者マスタだけは全期間で共有されるため、テスト用の車番・社員Noに絞る。
 */
async function clearChainTestData(): Promise<void> {
  await withLocalDb(async (DB) => {
    const nos = VEHICLE_NOS.map(() => "?").join(",");
    const codes = EMPLOYEE_CODES.map(() => "?").join(",");
    const byYearMonth = [
      "vehicle_pl_override",
      "pl_issue_ack",
      "manual_vehicle_input",
      "cleansing_decision",
      "review_flag",
      "deficit_factor_analysis",
      "vehicle_pl",
      "file_import_log",
      // raw_ingestion は csv_import_batch を参照するので先に消す
      "raw_ingestion",
      "csv_import_batch",
    ];
    await DB.batch([
      ...byYearMonth.map((table) =>
        DB.prepare(`DELETE FROM ${table} WHERE year_month = ?`).bind(YEAR_MONTH),
      ),
      DB.prepare(`DELETE FROM driver_master WHERE employee_code IN (${codes})`).bind(
        ...EMPLOYEE_CODES,
      ),
      DB.prepare(`UPDATE driver_master SET vehicle_no = NULL WHERE vehicle_no IN (${nos})`).bind(
        ...VEHICLE_NOS,
      ),
      DB.prepare(
        `UPDATE vehicle_master SET towed_by_vehicle_no = NULL WHERE towed_by_vehicle_no IN (${nos})`,
      ).bind(...VEHICLE_NOS),
      DB.prepare(`DELETE FROM vehicle_master WHERE vehicle_no IN (${nos})`).bind(...VEHICLE_NOS),
    ]);
  });
}

test.describe("締め作業の通し(取込→整形→手入力→チェック→確定→収支表→年間集計)", () => {
  const email = "e2e-chain@senpai-lab.com";
  const password = "TestPassw0rd!Chain";
  let cookie: Awaited<ReturnType<typeof getSessionCookie>>;

  test.beforeAll(async ({ baseURL }) => {
    await clearRateLimits();
    await clearChainTestData();
    await seedVehicleMaster();
    await createTestUser({ email, password, name: "E2E通し担当", role: "admin" });
    cookie = await getSessionCookie(baseURL!, email, password);
  });

  test.afterAll(async () => {
    await clearChainTestData();
    await deleteTestUserByEmail(email);
  });

  test.beforeEach(async ({ context }) => {
    await injectSessionCookie(context, cookie);
  });

  test("運行実績と売上を取り込むと、収支表の下地ができて次の手順が案内される", async ({ page }) => {
    await page.goto(`/import?ym=${YEAR_MONTH}`);

    /*
      取込画面は帳票ごとに投入口が分かれ、取り込み終えた帳票は畳まれて主役が次の帳票へ移る。
      畳まれた側は読み上げの対象から外れるため、見出しからカードを辿ると取込の直後に
      見つからなくなる。投入口そのものを名前で直接指す。
    */
    const fileInput = (label: string) =>
      page.locator(`input[type="file"][aria-label="${label}のファイルを選ぶ"]`);

    // 日付列を持たない帳票なので、何年何月分かを確定させてから取り込む
    await fileInput("車両別運行実績表").setInputFiles({
      name: OPERATION_FILE,
      mimeType: "text/csv",
      buffer: OPERATION_CSV,
    });
    await page.getByRole("button", { name: `${YEAR_MONTH_LABEL}分として取り込む` }).click();
    // この時点では売上が無いので収支表は作られない。理由がそう出ることまで見る
    await expect(page.getByText(/運行実績と売上の両方が揃うと作られます/)).toHaveCount(1);

    // 売上モニタリストは積荷日から年月が読めるので、確認を挟まずそのまま取り込む
    await fileInput("売上モニタリスト").setInputFiles({
      name: SALES_FILE,
      mimeType: "text/csv",
      buffer: SALES_CSV,
    });
    /*
      2つ揃った時点で収支表の下地ができる。ここが切れると以降の画面が全部空になる。
      結果の文言は畳まれたカードの中に残るので、見えているかではなく在るかで見る。
    */
    await expect(page.getByText(/収支表の下地を .*台分作りました/)).toHaveCount(1);

    /*
      課題A(4つ取り込んだあと、次に何をすればよいか分からない)の作り込み。
      固定の操作バーに次工程への入口が出ること、行き先が「いま取り込んだ月」であることを見る。
    */
    const next = page.getByRole("link", { name: "データ整形(STEP2)へ進む" });
    await expect(next).toBeVisible();
    await expect(next).toHaveAttribute("href", `/cleansing?ym=${YEAR_MONTH}`);
  });

  test("データ整形に、取り込んだ伝票が判断待ちとして出る", async ({ page }) => {
    await page.goto(`/cleansing?ym=${YEAR_MONTH}`);

    await expect(page.getByRole("heading", { name: /データ整形/ })).toBeVisible();
    // 「売上モニタリストが未取込です」= 取込が整形から見えていない状態。ここが出たら受け渡しが切れている
    await expect(page.getByText("売上モニタリストが未取込です")).toHaveCount(0);
    // 諸口の伝票は自動で消さず、判断待ちとして必ず人に出す
    await expect(page.getByText("諸口").first()).toBeVisible();
  });

  test("手入力の自動計算値に、取り込んだ売上の通行料が出ている", async ({ page }) => {
    // STEP6(高速料金)の通行料金は、空欄のままなら売上モニタリスト由来の金額が使われる。
    // その金額が欄に出ていれば、取込 → 収支表 → 手入力 の受け渡しがつながっている。
    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=6`);

    await expect(page.getByRole("heading", { name: /手入力/ })).toBeVisible();
    await page.getByPlaceholder("車番・運転者で検索").fill(VEHICLE_NOS[0]);

    const toll = page.getByRole("textbox", { name: new RegExp(`${VEHICLE_NOS[0]}番の通行料金`) });
    await expect(toll).toHaveValue(String(TOLL_9301));
  });

  test("チェック画面が、収支表のある月を未着手として扱わない", async ({ page }) => {
    await page.goto(`/anomaly?ym=${YEAR_MONTH}`);

    await expect(page.getByRole("heading", { name: /収支表のチェック/ })).toBeVisible();
    // 収支表があるのにこの文言が出るなら、チェック画面が別の月を見ている
    await expect(page.getByText("この月の収支表がまだありません")).toHaveCount(0);
  });

  test("月次収支表で確定でき、確定した月が年間集計に出る", async ({ page }) => {
    await page.goto(`/grid?ym=${YEAR_MONTH}`);

    await expect(page.getByRole("heading", { name: /月次収支表/ })).toBeVisible();
    await expect(page.getByText(/データはまだありません/)).toHaveCount(0);
    await expect(page.getByRole("cell", { name: VEHICLE_NOS[0], exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "この月を確定する" }).click();
    await expect(page.getByText("この月の収支表は確定済みです")).toBeVisible();

    // 年間集計は期(6月開始)で束ねる。対象月を渡したときに、その月が属する期が出ること
    await page.goto(`/annual?ym=${YEAR_MONTH}`);
    await expect(page.getByRole("heading", { name: /年間集計/ })).toBeVisible();
    await expect(page.getByText("この期のデータはまだありません")).toHaveCount(0);
    // 対象月が属する期(6月開始)が選ばれていること
    await expect(page.getByText("2025年6月〜2026年5月")).toBeVisible();
    // 月別の明細に、その月の列があること(ここが欠けると年間集計から月が消える)
    await page.getByText("月別の明細を見る").click();
    await expect(page.getByRole("columnheader", { name: /11月/ })).toBeVisible();
  });
});
