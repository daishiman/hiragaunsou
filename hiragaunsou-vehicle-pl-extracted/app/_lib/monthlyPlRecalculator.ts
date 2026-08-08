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
