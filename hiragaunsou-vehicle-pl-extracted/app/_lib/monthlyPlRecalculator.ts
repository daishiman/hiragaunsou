import { D1ImportBatchRepository } from "../../src/infrastructure/db/D1ImportBatchRepository";
import {
  D1DriverMasterRepository,
  D1RateMasterRepository,
  D1VehicleMasterRepository,
} from "../../src/infrastructure/db/D1MasterRepository";
import { D1VehiclePlRepository } from "../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ManualInputRepository } from "../../src/infrastructure/db/D1ManualInputRepository";
import { D1VehiclePlOverrideRepository } from "../../src/infrastructure/db/D1VehiclePlOverrideRepository";
import {
  D1AppSettingRepository,
  D1CleansingDecisionRepository,
} from "../../src/infrastructure/db/D1CleansingDecisionRepository";
import { FinalizeMonthlyPlUseCase } from "../../src/usecase/steps/finalizeMonthlyPl";
import { RecalculateMonthlyPlUseCase } from "../../src/usecase/steps/recalculateMonthlyPl";
import type { Db } from "../../src/infrastructure/db/client";

/**
 * 収支表を作り直す入口の組み立て。
 *
 * 再計算の材料集めは RecalculateMonthlyPlUseCase に閉じ込めてある。
 * 呼び出し側が自前に集めるとキリン配賦や整形判断を渡し忘れ、上書きを1件保存しただけで
 * 別の車両の値が消える。年月しか渡さない形を保つこと。
 *
 * 組み立て自体を複数のRoute Handlerで書き写すと、依存を1つ足したときに片方だけ古くなる。
 * そのためここに1つだけ置く。
 */
export function monthlyPlRecalculator(db: Db) {
  const rateMasterRepo = new D1RateMasterRepository(db);
  return new RecalculateMonthlyPlUseCase(
    new D1ManualInputRepository(db),
    new D1CleansingDecisionRepository(db),
    new D1AppSettingRepository(db),
    rateMasterRepo,
    new D1VehiclePlOverrideRepository(db),
    new FinalizeMonthlyPlUseCase(
      new D1ImportBatchRepository(db),
      new D1VehicleMasterRepository(db),
      new D1DriverMasterRepository(db),
      rateMasterRepo,
      new D1VehiclePlRepository(db),
    ),
  );
}

export type PostImportRebuildResult =
  | { status: "built"; vehicleCount: number }
  | { status: "skipped"; reason: "imports_incomplete" | "confirmed" | "failed" };

/**
 * 取込のあとに収支表(vehicle_pl)の下地を作る。
 *
 * 収支表はこれまで「手入力の最後で作り直す」まで1行も存在しなかった。そのため取込を
 * 終えた直後は、手入力のタイヤ代・高速料金の自動計算値が0(走行km・通行料金を収支表から
 * 読むため)、ホームの進捗が「先に運行実績・売上の取込が必要です」、月次収支表・年間集計が空、
 * という「4つとも取り込んだのに、どの画面にも何も出ない」状態になっていた。
 *
 * 運行実績と売上が揃った時点でここが下地を作り、以降の画面が取込内容をそのまま読めるようにする。
 * 手入力はこの下地に上書きしていく形になり、入力の有無にかかわらず画面の数字が動く。
 *
 * 確定済みの月では作り直さない。締めた月の数字が取込のたびに黙って動き、確定まで外れると、
 * 「締めた」という意思表示が意味を失うため。
 */
export async function rebuildMonthlyPlAfterImport(
  db: Db,
  yearMonth: string,
): Promise<PostImportRebuildResult> {
  // 下地づくりに失敗しても取込自体は成功している。取込を失敗として巻き戻すと
  // 「取り込めたはずのファイルが消える」ほうが困るので、判定・実行のどちらで転んでも
  // ここで受け止めて、結果だけを画面に伝える。
  try {
    const importBatchRepo = new D1ImportBatchRepository(db);
    const vehiclePlRepo = new D1VehiclePlRepository(db);

    const [opBatch, salesBatch, confirmation] = await Promise.all([
      importBatchRepo.findLatestBatch(yearMonth, "vehicle_operation"),
      importBatchRepo.findLatestBatch(yearMonth, "sales_monitor"),
      vehiclePlRepo.getConfirmation(yearMonth),
    ]);

    // 走行距離(運行実績)と売上の両方が揃わないと1台分も計算できない。
    if (!opBatch || !salesBatch) return { status: "skipped", reason: "imports_incomplete" };
    if (confirmation.total > 0 && confirmation.confirmed >= confirmation.total) {
      return { status: "skipped", reason: "confirmed" };
    }

    const result = await monthlyPlRecalculator(db).execute({ yearMonth });
    return { status: "built", vehicleCount: result.vehicleCount };
  } catch (e) {
    console.error("post-import PL rebuild failed", { yearMonth, error: e });
    return { status: "skipped", reason: "failed" };
  }
}
