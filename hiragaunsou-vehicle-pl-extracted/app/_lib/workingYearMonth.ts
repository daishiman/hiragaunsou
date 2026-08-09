import { D1ImportBatchRepository } from "../../src/infrastructure/db/D1ImportBatchRepository";
import { D1VehiclePlRepository } from "../../src/infrastructure/db/D1VehiclePlRepository";
import type { Db } from "../../src/infrastructure/db/client";
import { defaultImportYearMonth } from "./yearMonth";

/**
 * いま締め作業をしている月を決める。
 *
 * ホームの「次にやること」はこれまで当月固定だった。そのため2026年5月分を取り込んでも
 * ホームは当月(8月)の話をし続け、「4つとも取り込んだのに、次に何をすればいいのか分からない」
 * という状態になっていた。取込画面の既定(前月)ともズレていて、同じ画面のはずが月だけ違う、
 * という食い違いも起きていた。
 *
 * 判定は実データから行う: 取込のある月のうち、まだ締めていない最も新しい月。
 * 取込が1件も無ければ取込画面と同じ既定(前月)に揃える。
 */
export async function resolveWorkingYearMonth(db: Db): Promise<string> {
  const months = await new D1ImportBatchRepository(db).listYearMonths(13);
  if (months.length === 0) return defaultImportYearMonth();

  const vehiclePlRepo = new D1VehiclePlRepository(db);
  // 月ごとに順番に問い合わせると、締め済みが続いたときだけ遅くなる。件数は13件に限ってあるので
  // まとめて聞いて、新しい順で最初に見つかった未確定月を採る。
  const confirmations = await Promise.all(
    months.map(async (ym) => ({ ym, c: await vehiclePlRepo.getConfirmation(ym) })),
  );
  const working = confirmations.find(
    ({ c }) => !(c.total > 0 && c.confirmed >= c.total),
  );
  // 全部締め済みなら、次に作業するのは最も新しい月の次。取込画面の既定と同じ考え方に戻す。
  return working?.ym ?? defaultImportYearMonth();
}
