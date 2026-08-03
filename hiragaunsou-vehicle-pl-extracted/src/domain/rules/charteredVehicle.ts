import { CHARTERED_VEHICLE_NO } from "../entities/VehiclePl";

/**
 * 傭車(社外車両)判定。車番88888は自社の収支計算対象から機械的に除外してよい
 * (要件定義で明記された確定ルール)。Domain層: 外部依存なし。
 */
export function isCharteredVehicle(vehicleNo: string): boolean {
  return vehicleNo.trim() === CHARTERED_VEHICLE_NO;
}
