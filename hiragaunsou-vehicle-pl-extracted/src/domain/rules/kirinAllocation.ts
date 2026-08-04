/**
 * 業務フロー STEP2: キリンの輸送協力金・経営支援金の配賦ルール。
 *
 * 業務フロー docx より:
 *   「キリンの輸送協力金と経営支援金を2等分し、24番・300番の『その他』欄にそれぞれ入力する」
 *   配分理由: この2台がキリンの配送を専属で行っているため。
 *   他車両もキリン配送に入ることがあるが、スポット運行のため配分対象外。
 *
 * 対象車番は属人知識なのでハードコードせず、既定値を持ちつつ呼び出し側で差し替えられる形にする。
 *
 * Domain層: フレームワーク非依存。
 */

/** 既定の配賦対象車番 (キリン専属の2台) */
export const DEFAULT_KIRIN_TARGET_VEHICLES = ["24", "300"] as const;

export interface KirinSupportInput {
  /** 輸送協力金 (円) */
  transportSupport: number;
  /** 経営支援金 (円) */
  managementSupport: number;
  /** 配賦対象の車番。未指定なら既定の2台 */
  targetVehicleNos?: readonly string[];
}

export interface KirinAllocation {
  vehicleNo: string;
  /** その車番の「その他」欄に加算する金額 (円) */
  amount: number;
}

function sanitize(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}

/**
 * 輸送協力金・経営支援金の合計を対象車両へ等分する。
 *
 * - 1円未満の端数は先頭の車両に寄せ、配賦額の合計が原資と必ず一致するようにする
 *   (「配賦したのに合計が合わない」という静かなズレを作らないため)。
 * - 対象車両が空、または原資が0のときは空配列を返す(0円の行を作らない)。
 */
export function allocateKirinSupport(input: KirinSupportInput): KirinAllocation[] {
  const targets = input.targetVehicleNos ?? DEFAULT_KIRIN_TARGET_VEHICLES;
  const total = sanitize(input.transportSupport) + sanitize(input.managementSupport);

  if (targets.length === 0 || total === 0) return [];

  const share = Math.floor(total / targets.length);
  const remainder = total - share * targets.length;

  return targets.map((vehicleNo, i) => ({
    vehicleNo,
    amount: i === 0 ? share + remainder : share,
  }));
}
