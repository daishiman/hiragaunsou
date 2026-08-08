import type { VehiclePlOverride } from "../rules/vehiclePlOverride";

/** 保存済みの上書き (誰がいつ直したかを画面に出すため、監査情報を併せて返す)。 */
export interface VehiclePlOverrideRecord extends VehiclePlOverride {
  updatedAt: Date;
  updatedByName: string | null;
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
  /** year_month + vehicle_no で upsert する */
  save(
    yearMonth: string,
    override: VehiclePlOverride,
    updatedBy: string | null,
  ): Promise<void>;
  /** 上書きを取り消して、CSVと手入力から計算した素の値に戻す */
  remove(yearMonth: string, vehicleNo: string): Promise<void>;
}
