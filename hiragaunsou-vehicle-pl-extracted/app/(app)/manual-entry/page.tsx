import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehicleMasterRepository, D1RateMasterRepository } from "../../../src/infrastructure/db/D1MasterRepository";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ImportBatchRepository } from "../../../src/infrastructure/db/D1ImportBatchRepository";
import { D1DriverMasterRepository } from "../../../src/infrastructure/db/D1MasterRepository";
import { GetPayrollDetailByVehicleUseCase } from "../../../src/usecase/steps/getPayrollDetailByVehicle";
import { currentYearMonth, selectableYearMonths } from "../../_lib/yearMonth";
import { PageHead } from "../../_components/PageHead";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { ManualEntryStepper, type PrefillValues } from "./ManualEntryStepper";

/** 手入力フォーム(Google-Forms風ステップ)。層③(修理費実費/インタンク単価/外部給油明細/給与確認/例外上書き)を入力する。 */
export default async function ManualEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; step?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "input")) redirect("/");

  const { ym, step } = await searchParams;
  const yearMonth = ym || currentYearMonth();

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const vehicleMasterRepo = new D1VehicleMasterRepository(db);
  const rateMasterRepo = new D1RateMasterRepository(db);
  const vehiclePlRepo = new D1VehiclePlRepository(db);
  const importBatchRepo = new D1ImportBatchRepository(db);
  const driverMasterRepo = new D1DriverMasterRepository(db);

  const [vehicles, existingRows, rates, payrollBatch, drivers, payrollDetail] = await Promise.all([
    vehicleMasterRepo.findAllActive(),
    vehiclePlRepo.findByYearMonth(yearMonth),
    rateMasterRepo.getRates(yearMonth),
    importBatchRepo.findLatestBatch(yearMonth, "payroll"),
    driverMasterRepo.findAll(),
    new GetPayrollDetailByVehicleUseCase(importBatchRepo, vehicleMasterRepo, driverMasterRepo).execute(
      yearMonth,
    ),
  ]);

  // 運転者マスタは車番と1:1ではない(2人乗務等)ため、同じ車番の運転者名は"/"区切りでまとめる。
  const driverNameByVehicle = new Map<string, string>();
  for (const driver of drivers) {
    if (!driver.vehicleNo) continue;
    const existing = driverNameByVehicle.get(driver.vehicleNo);
    driverNameByVehicle.set(
      driver.vehicleNo,
      existing ? `${existing}/${driver.driverName}` : driver.driverName,
    );
  }

  const byVehicle = new Map(existingRows.map((r) => [r.no, r]));
  const pick = (field: "repair" | "fuelOut" | "fuelOutQty" | "fuelInQty" | "adblue" | "equip" | "mainte" | "miscOther") => {
    const record: Record<string, number> = {};
    for (const v of vehicles) {
      record[v.vehicleNo] = byVehicle.get(v.vehicleNo)?.[field] ?? 0;
    }
    return record;
  };

  // 車両マスタが空だと入力欄が1行も出せない。そのとき「今月どれだけの車両が動いていたか」を
  // 添えられるよう、運行実績に出てきた車番の数だけ数える(0台のときにしか読まないので通常は負荷ゼロ)。
  let operatedVehicleCount = 0;
  if (vehicles.length === 0) {
    const opRows = await importBatchRepo.findRawRows(yearMonth, "vehicle_operation");
    operatedVehicleCount = new Set(opRows.map((r) => r.naturalKey).filter(Boolean)).size;
  }

  const prefill: PrefillValues = {
    repairActual: pick("repair"),
    fuelOut: pick("fuelOut"),
    fuelOutQty: pick("fuelOutQty"),
    fuelInQty: pick("fuelInQty"),
    adblue: pick("adblue"),
    equip: pick("equip"),
    mainte: pick("mainte"),
    miscOther: pick("miscOther"),
    tankPricePerLiter: rates.tankPricePerLiter,
  };

  return (
    // 1台1行に燃料4項目・経費4項目を並べるため、他の入力画面より広く取る
    <div className="max-w-5xl">
      <PageHead
        kind="ops"
        title="手入力(業務フロー STEP2・3・5・6)"
        lead="請求書から入力する項目だけをステップ順に。Enterで次の欄へ"
        showHomeLink
        action={
          <YearMonthSelect
            basePath="/manual-entry"
            value={yearMonth}
            options={selectableYearMonths(13)}
          />
        }
      />
      <ManualEntryStepper
        key={yearMonth}
        yearMonth={yearMonth}
        vehicles={vehicles.map((v) => ({
          vehicleNo: v.vehicleNo,
          driver: driverNameByVehicle.get(v.vehicleNo) ?? null,
        }))}
        prefill={prefill}
        payrollStatus={payrollBatch}
        payrollDetail={payrollDetail}
        initialWorkflowStep={step ?? null}
        operatedVehicleCount={operatedVehicleCount}
        canManageVehicleMaster={checkAccess(session, "manage_imports")}
      />
    </div>
  );
}
