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

/**
 * ホーム最上段の経営サマリが話題にする月を決める。
 *
 * ここは「儲かっているか」を見る場所なので、締めた月の数字を出したい。
 * これまでは単純に前月固定で、確定したかどうかも取込があるかどうかも見ていなかった。
 * そのため、取込が1件も無い月に収支表だけが残っていると(取込ゼロの月に収支表が
 * 作られる経路があった)、売上0円・赤字だけが並ぶ架空のサマリがホームの一番上に出る。
 *
 * 判定はすべて実データから行う:
 *   1. 取込のある月のうち、確定済みの最も新しい月 (締めた実績)
 *   2. まだ1つも締めていなければ、取込のある最も新しい月 (作業中の月の途中経過)
 *   3. 取込が1件も無ければ取込画面と同じ既定 (前月)
 *
 * 取込のある月だけを候補にするのが要点。収支表の行があるかどうかで選ぶと、
 * 取込ゼロの月の収支表を拾ってしまい、直したはずの症状がここだけ再発する。
 *
 * どの根拠で選んだかも返す。締めた月の数字か、まだ作業中の月の途中経過かで
 * 数字の読み方が変わるため、画面の見出しで言い分ける必要がある。
 */
export type OverviewYearMonth = {
  yearMonth: string;
  /** confirmed = 締め済みの月 / inProgress = まだ締めていない作業中の月 */
  basis: "confirmed" | "inProgress";
};

export async function resolveOverviewYearMonth(db: Db): Promise<OverviewYearMonth> {
  const months = await new D1ImportBatchRepository(db).listYearMonths(24);
  if (months.length === 0) {
    return { yearMonth: defaultImportYearMonth(), basis: "inProgress" };
  }

  const vehiclePlRepo = new D1VehiclePlRepository(db);
  const confirmations = await Promise.all(
    months.map(async (ym) => ({ ym, c: await vehiclePlRepo.getConfirmation(ym) })),
  );
  const confirmed = confirmations.find(({ c }) => c.total > 0 && c.confirmed >= c.total);
  if (confirmed) return { yearMonth: confirmed.ym, basis: "confirmed" };
  return {
    yearMonth: months[0] ?? defaultImportYearMonth(),
    basis: "inProgress",
  };
}
