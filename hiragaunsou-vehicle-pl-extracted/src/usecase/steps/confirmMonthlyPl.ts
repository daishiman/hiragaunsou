import type {
  ReviewFlagRepository,
  VehiclePlRepository,
} from "../../domain/repositories/VehiclePlRepository";

/**
 * 業務フロー STEP8「運送収支表への転記(完成)」の代替。
 *
 * Excelの該当月シートへ貼り付ける代わりに、月次収支表を「確定」して締める。
 * 確定後に取込・手入力をやり直すと収支表が作り直され、確定は自動的に外れる
 * (D1VehiclePlRepository.upsertMany が confirmed を false に戻す)。
 */
export interface ConfirmationStatus {
  yearMonth: string;
  /** 収支表の行数 (0なら締められる状態にない) */
  total: number;
  /** 確定済みの行数 */
  confirmedCount: number;
  /** 全行が確定済みか */
  isConfirmed: boolean;
  /** 未判定の異常値件数 (0でなくても確定はできるが、画面で注意を出す) */
  openFlagCount: number;
  /** 確定操作を受け付けられるか */
  canConfirm: boolean;
}

export class ConfirmMonthlyPlUseCase {
  constructor(
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly reviewFlagRepo: ReviewFlagRepository,
  ) {}

  async status(yearMonth: string): Promise<ConfirmationStatus> {
    const [confirmation, openFlags] = await Promise.all([
      this.vehiclePlRepo.getConfirmation(yearMonth),
      this.reviewFlagRepo.findOpenByYearMonth(yearMonth),
    ]);
    return {
      yearMonth,
      total: confirmation.total,
      confirmedCount: confirmation.confirmed,
      isConfirmed: confirmation.total > 0 && confirmation.confirmed >= confirmation.total,
      openFlagCount: openFlags.length,
      canConfirm: confirmation.total > 0,
    };
  }

  /** 確定する / 確定を外す。確定を外す方向は行が無くても素通しする(状態を戻すだけのため) */
  async execute(yearMonth: string, confirmed: boolean): Promise<ConfirmationStatus> {
    if (confirmed) {
      const before = await this.status(yearMonth);
      if (!before.canConfirm) {
        throw new Error("この月にはまだ収支表がありません。取込と手入力を先に済ませてください");
      }
    }
    await this.vehiclePlRepo.setConfirmed(yearMonth, confirmed);
    return this.status(yearMonth);
  }
}
