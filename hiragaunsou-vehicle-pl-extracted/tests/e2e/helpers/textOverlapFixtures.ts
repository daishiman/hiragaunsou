import { getPlatformProxy } from "wrangler";
import { withBusyRetry } from "./testUsers";

/**
 * 文字重なりE2Eだけが使う予約済みの車両。
 *
 * 実在する車番と衝突しない名前・未来月・印を組み合わせる。削除時は車番だけでなく
 * depot の印も照合し、同じ車番の利用者データが万一あっても触らない。
 */
export const TEXT_OVERLAP_VEHICLE_NO = "E2EOVLP901";
export const TEXT_OVERLAP_YEAR_MONTH = "2099-12";
const FIXTURE_DEPOT = "__E2E_TEXT_OVERLAP__";
const FIXTURE_PL_ID = "e2e-text-overlap-vehicle-pl";

async function withLocalDb(
  run: (db: D1Database) => Promise<void>,
): Promise<void> {
  const proxy = await getPlatformProxy();
  try {
    await run(proxy.env.DB as D1Database);
  } finally {
    await proxy.dispose();
  }
}

/** 実在する動的routeと、数字が描かれる状態を決定論的に作る。 */
export async function seedTextOverlapVehicle(): Promise<void> {
  await withLocalDb(async (db) => {
    await withBusyRetry(() =>
      db
        .prepare("DELETE FROM vehicle_pl WHERE id = ? AND vehicle_no = ?")
        .bind(FIXTURE_PL_ID, TEXT_OVERLAP_VEHICLE_NO)
        .run(),
    );
    await withBusyRetry(() =>
      db
        .prepare(
          "DELETE FROM vehicle_master WHERE vehicle_no = ? AND depot = ?",
        )
        .bind(TEXT_OVERLAP_VEHICLE_NO, FIXTURE_DEPOT)
        .run(),
    );

    // marker条件に一致しない同名車両があればINSERTが失敗する。上書き・削除はしない。
    await withBusyRetry(() =>
      db
        .prepare(
          "INSERT INTO vehicle_master (vehicle_no, vehicle_type, depot, cost_category, active) VALUES (?, 'E2E確認車', ?, 'large', 1)",
        )
        .bind(TEXT_OVERLAP_VEHICLE_NO, FIXTURE_DEPOT)
        .run(),
    );
    await withBusyRetry(() =>
      db
        .prepare(
          "INSERT INTO vehicle_pl (id, year_month, vehicle_no, type, depot, sales, fare, expense, profit, margin) VALUES (?, ?, ?, 'E2E確認車', ?, 1234567, 1234567, 345678, 888889, 0.72)",
        )
        .bind(
          FIXTURE_PL_ID,
          TEXT_OVERLAP_YEAR_MONTH,
          TEXT_OVERLAP_VEHICLE_NO,
          FIXTURE_DEPOT,
        )
        .run(),
    );
  });
}

export async function cleanupTextOverlapVehicle(): Promise<void> {
  await withLocalDb(async (db) => {
    await withBusyRetry(() =>
      db
        .prepare("DELETE FROM vehicle_pl WHERE id = ? AND vehicle_no = ?")
        .bind(FIXTURE_PL_ID, TEXT_OVERLAP_VEHICLE_NO)
        .run(),
    );
    await withBusyRetry(() =>
      db
        .prepare(
          "DELETE FROM vehicle_master WHERE vehicle_no = ? AND depot = ?",
        )
        .bind(TEXT_OVERLAP_VEHICLE_NO, FIXTURE_DEPOT)
        .run(),
    );
  });
}
