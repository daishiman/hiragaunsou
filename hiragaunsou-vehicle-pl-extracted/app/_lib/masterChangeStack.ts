import { D1ImportBatchRepository } from "../../src/infrastructure/db/D1ImportBatchRepository";
import {
  D1DriverMasterRepository,
  D1RateMasterRepository,
  D1VehicleMasterRepository,
} from "../../src/infrastructure/db/D1MasterRepository";
import { D1VehiclePlRepository } from "../../src/infrastructure/db/D1VehiclePlRepository";
import { D1MasterChangeRepository } from "../../src/infrastructure/db/D1MasterChangeRepository";
import { D1MasterValueWriter } from "../../src/infrastructure/db/D1MasterValueWriter";
import {
  D1ImportCompareSnapshotRepository,
  D1ImportDiffAbsorbedRepository,
  D1ImportDiffAckRepository,
} from "../../src/infrastructure/db/D1ImportDiffRepository";
import { D1ManualInputRepository } from "../../src/infrastructure/db/D1ManualInputRepository";
import { D1VehiclePlOverrideRepository } from "../../src/infrastructure/db/D1VehiclePlOverrideRepository";
import {
  D1AppSettingRepository,
  D1CleansingDecisionRepository,
} from "../../src/infrastructure/db/D1CleansingDecisionRepository";
import { FinalizeMonthlyPlUseCase } from "../../src/usecase/steps/finalizeMonthlyPl";
import { RecalculateMonthlyPlUseCase } from "../../src/usecase/steps/recalculateMonthlyPl";
import {
  ApplyMasterChangeUseCase,
  ApplyToConfirmedMonthUseCase,
  GetMasterChangeStatusUseCase,
  RevertConfirmedMonthApplyUseCase,
  UndoMasterEditUseCase,
} from "../../src/usecase/steps/applyMasterChange";
import { DetectImportDiffUseCase } from "../../src/usecase/steps/importDiffAlert";
import { CapturingVehiclePlRepository } from "../../src/usecase/steps/previewMonthlyPl";
import type { MonthlyPlPreviewer } from "../../src/usecase/steps/previewMonthlyPl";
import { monthlyPlRecalculator } from "./monthlyPlRecalculator";
import type { Db } from "../../src/infrastructure/db/client";

/**
 * マスタの直しと、その反映まわりの組み立て。
 *
 * 「いまのマスタで作り直したらどうなるか」は、本番の作り直しと同じ計算を通しつつ
 * 保存先だけ差し替えて求める。計算を書き写すと、本番と食い違う「もう1つの収支表」が
 * できてしまい、どちらが正しいか誰にも分からなくなる。
 */
export function masterChangeStack(db: Db, actor: { id: string | null; name: string }) {
  const vehiclePlRepo = new D1VehiclePlRepository(db);
  const vehicleMasterRepo = new D1VehicleMasterRepository(db);
  const driverMasterRepo = new D1DriverMasterRepository(db);
  const rateMasterRepo = new D1RateMasterRepository(db);
  const historyRepo = new D1MasterChangeRepository(db);
  const rebuilder = monthlyPlRecalculator(db);

  const previewer: MonthlyPlPreviewer = {
    async preview(yearMonth: string) {
      // 材料集め (手入力・整形判断・キリン配賦・上書き) は本番と同じ入口に任せる。
      // ここで自前に集めると、集め忘れた材料のぶんだけ「食い違い」が嘘になる。
      const capturing = new CapturingVehiclePlRepository(vehiclePlRepo);
      await new RecalculateMonthlyPlUseCase(
        new D1ManualInputRepository(db),
        new D1CleansingDecisionRepository(db),
        new D1AppSettingRepository(db),
        rateMasterRepo,
        new D1VehiclePlOverrideRepository(db),
        new FinalizeMonthlyPlUseCase(
          new D1ImportBatchRepository(db),
          vehicleMasterRepo,
          driverMasterRepo,
          rateMasterRepo,
          capturing,
        ),
      ).execute({ yearMonth });
      return capturing.result();
    },
  };

  const applier = new ApplyMasterChangeUseCase(historyRepo, rebuilder);

  return {
    historyRepo,
    previewer,
    /** マスタを直したあとに呼ぶ (まだ締めていない月だけ作り直す) */
    applier,
    /** 据え置いた月の食い違い・履歴・反映記録をまとめて読む */
    status: new GetMasterChangeStatusUseCase(historyRepo, vehiclePlRepo, previewer),
    /** 確定済みの月へ、人が選んで反映する */
    applyToConfirmed: new ApplyToConfirmedMonthUseCase(historyRepo, vehiclePlRepo, previewer, rebuilder),
    /** 確定済み月への反映を取り消す */
    revert: new RevertConfirmedMonthApplyUseCase(historyRepo, vehiclePlRepo),
    /** マスタの直しそのものを元に戻す */
    undo: new UndoMasterEditUseCase(
      historyRepo,
      new D1MasterValueWriter({ vehicleMasterRepo, driverMasterRepo, rateMasterRepo, actorId: actor.id }),
      applier,
    ),
    writer: new D1MasterValueWriter({
      vehicleMasterRepo,
      driverMasterRepo,
      rateMasterRepo,
      actorId: actor.id,
    }),
  };
}

/** 取込の「前回と異なります」の組み立て */
export function importDiffDetector(db: Db) {
  return new DetectImportDiffUseCase({
    vehicleMasterRepo: new D1VehicleMasterRepository(db),
    driverMasterRepo: new D1DriverMasterRepository(db),
    snapshotRepo: new D1ImportCompareSnapshotRepository(db),
    ackRepo: new D1ImportDiffAckRepository(db),
    absorbedRepo: new D1ImportDiffAbsorbedRepository(db),
  });
}

/** 「確認済み」を押したときの保存先 */
export function importDiffAckRepository(db: Db) {
  return new D1ImportDiffAckRepository(db);
}
