import type { VehiclePlOverride } from "../rules/vehiclePlOverride";

/** 保存済みの上書き (誰がいつ直したかを画面に出すため、監査情報を併せて返す)。 */
export interface VehiclePlOverrideRecord extends VehiclePlOverride {
  updatedAt: Date;
  updatedByName: string | null;
  /**
   * この直しを収支表へ反映(再計算)した時刻。null は「まだ反映していない」。
   * 画面はこれを見て「反映待ち」の印と件数を出す。
   */
  appliedAt: Date | null;
}

/**
 * 車両単位の最終上書きの永続化。
 *
 * 上書きは「毎月やり直される手直し」を仕組みに載せるためのもので、
 * 収支表を作り直すたびに読み直される必要がある。保存されていない上書きは
 * 次の再計算で静かに消えるため、必ずここを通す。
 */
export interface VehiclePlOverrideRepository {
  findByYearMonth(yearMonth: string): Promise<VehiclePlOverrideRecord[]>;
  /** 1台分だけ読む (保存前に他の人が先に直していないかを確かめるために使う) */
  findOne(yearMonth: string, vehicleNo: string): Promise<VehiclePlOverrideRecord | null>;
  /** year_month + vehicle_no で upsert する。保存した直しは「未反映」になる */
  save(
    yearMonth: string,
    override: VehiclePlOverride,
    updatedBy: string | null,
  ): Promise<void>;
  /** 上書きを取り消して、CSVと手入力から計算した素の値に戻す */
  remove(yearMonth: string, vehicleNo: string): Promise<void>;
  /** まだ収支表に反映していない直しの件数 (画面の「反映待ちN件」) */
  countPending(yearMonth: string): Promise<number>;
  /**
   * 反映済みの印を付ける。
   * asOf より後に保存された直しには付けない。再計算の最中に入った直しを
   * 「反映済み」と誤って記録しないため(反映漏れは黙って数字が古いままになる)。
   */
  markApplied(yearMonth: string, asOf: Date): Promise<void>;
}
