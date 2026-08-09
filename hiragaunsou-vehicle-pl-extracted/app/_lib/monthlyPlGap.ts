import { D1ImportBatchRepository } from "../../src/infrastructure/db/D1ImportBatchRepository";
import { D1VehicleMasterRepository } from "../../src/infrastructure/db/D1MasterRepository";
import type { Db } from "../../src/infrastructure/db/client";

/**
 * 「その月の収支表が0台なのはなぜか」を1箇所で判定する。
 *
 * 月次収支表・チェック・手入力は、どれも収支表(vehicle_pl)の行が母集合になっている。
 * 行が0のときに各画面がそれぞれの文言を出していたため、
 * 取込を全部終えた人に「データ取込へ」と出す(何をしても進まない)、
 * チェック画面が0台を「すべて判定済みです」と出す(終わったように見える)、
 * といった行き止まりが画面ごとに生まれていた。
 *
 * 理由と次の1歩をここで作り、画面はそれを表示するだけにする。
 */

export type MonthlyPlGapKind =
  /** 運行実績・売上のどちらかがまだ取り込まれていない */
  | "not_imported"
  /** 取込は済んでいるが、収支表の行を作る元になる車両マスタが空 */
  | "no_vehicle_master"
  /** 材料は揃っている。あとは収支表を作り直せば出る */
  | "rebuildable";

export interface MonthlyPlGap {
  kind: MonthlyPlGapKind;
  /** なぜ空なのかを業務の言葉で1行。 */
  title: string;
  /** 次に何をすればよいか。 */
  description: string;
  /** 「作り直す」以外の解決先(その画面へ行けば直せる)。 */
  action: { href: string; label: string } | null;
}

/**
 * 収支表が0台の月について、理由と次の1歩を返す。
 * 行が1台でもある月では呼ばない(呼び出し側が空のときだけ使う)。
 */
export async function resolveMonthlyPlGap(db: Db, yearMonth: string): Promise<MonthlyPlGap> {
  const importBatchRepo = new D1ImportBatchRepository(db);
  const [opBatch, salesBatch, vehicles] = await Promise.all([
    importBatchRepo.findLatestBatch(yearMonth, "vehicle_operation"),
    importBatchRepo.findLatestBatch(yearMonth, "sales_monitor"),
    new D1VehicleMasterRepository(db).findAllActive(),
  ]);

  if (!opBatch || !salesBatch) {
    const missing = [
      opBatch ? null : "車両別運行実績表",
      salesBatch ? null : "売上モニタリスト",
    ].filter((v): v is string => v !== null);
    return {
      kind: "not_imported",
      title: "この月はまだ取り込まれていません",
      description: `${missing.join("と")}を取り込むと、車両ごとの収支がここに出ます。`,
      action: { href: "/import", label: "データ取込へ" },
    };
  }

  if (vehicles.length === 0) {
    /*
      収支表の行は車両マスタの車両から作られる。ここで「取込へ」と案内すると、
      取込を終えた人が取込をやり直し続けることになる(やり直しても結果は変わらない)。
    */
    return {
      kind: "no_vehicle_master",
      title: "車両マスタに車両が1台も登録されていません",
      description:
        "収支表は車両マスタの車両ごとに作られるため、車両を登録するまで1台も出せません。登録すると、取込済みの月の収支表がまとめて作られます。",
      action: { href: "/admin/vehicle-master", label: "車両マスタを登録する" },
    };
  }

  return {
    kind: "rebuildable",
    title: "取り込んだ内容から、この月の収支表をまだ作っていません",
    description:
      "運行実績・売上は取込済みです。「この月の収支表を作る」を押すと、取り込んだ内容から車両ごとの収支を作ります。",
    action: null,
  };
}
