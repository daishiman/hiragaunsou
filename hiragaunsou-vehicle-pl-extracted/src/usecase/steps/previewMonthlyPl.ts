import type { VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";

/**
 * 「いまのマスタで作り直したら、収支表はどうなるか」を**書かずに**求める。
 *
 * 確定済みの月は据え置くと決めた以上、食い違いを見せるためだけに本物の作り直しを
 * 走らせるわけにはいかない (走らせた瞬間に据え置きが破れる)。
 *
 * ただし計算そのものを書き写すと、本番の計算と食い違う「もう1つの収支表」が生まれる。
 * それは最も避けたい事態なので、計算は FinalizeMonthlyPlUseCase をそのまま使い、
 * 保存先だけを差し替える。保存先はコンストラクタ引数なので、本体には一切手を入れずに済む。
 */
export class CapturingVehiclePlRepository implements VehiclePlRepository {
  /** 作り直しの結果。upsertMany に渡ってきた行をそのまま受け取る */
  private captured: VehiclePlCalculated[] = [];
  /** 作り直しの結果、その月から落ちる車番 */
  private removed = new Set<string>();

  constructor(private readonly source: VehiclePlRepository) {}

  /** 書かない。渡された行を控えるだけ */
  async upsertMany(_yearMonth: string, rows: VehiclePlCalculated[]): Promise<void> {
    void _yearMonth;
    this.captured = rows;
  }

  /** 消さない。落ちる車番を控えるだけ */
  async removeVehicles(_yearMonth: string, vehicleNos: readonly string[]): Promise<void> {
    void _yearMonth;
    for (const no of vehicleNos) this.removed.add(no);
  }

  /**
   * 作り直した結果の行。
   *
   * upsertMany に渡る行にも、けん引先へ吸収されて消えるはずのトレーラが
   * 混ざることはない (FinalizeMonthlyPlUseCase が計算前に除いている) が、
   * 除外指定の車両は removeVehicles 側にしか現れないため、念のため両方で濾す。
   */
  result(): VehiclePlCalculated[] {
    return this.captured.filter((row) => !this.removed.has(row.no));
  }

  // 以下は読み取り。作り直しの材料として本物を読む必要があるのでそのまま委譲する。
  findByYearMonth(yearMonth: string) {
    return this.source.findByYearMonth(yearMonth);
  }
  findByVehicleNo(vehicleNo: string) {
    return this.source.findByVehicleNo(vehicleNo);
  }
  findByYearMonths(yearMonths: readonly string[]) {
    return this.source.findByYearMonths(yearMonths);
  }
  countByYearMonth(yearMonth: string) {
    return this.source.countByYearMonth(yearMonth);
  }
  getConfirmation(yearMonth: string) {
    return this.source.getConfirmation(yearMonth);
  }

  /**
   * 確定状態は動かさない。
   *
   * 下書きの計算から確定が外れると、据え置いたはずの月が「まだ締めていない」に化ける。
   */
  async setConfirmed(_yearMonth: string, _confirmed: boolean): Promise<void> {
    void _yearMonth;
    void _confirmed;
  }
}

/** 年月を渡すと「いまのマスタならこうなる」行を返すもの。 */
export interface MonthlyPlPreviewer {
  preview(yearMonth: string): Promise<VehiclePlCalculated[]>;
}
