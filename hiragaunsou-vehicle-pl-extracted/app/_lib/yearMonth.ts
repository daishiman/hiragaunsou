/** 現在の年月を YYYY-MM (JST基準) で返す。Presentation層の表示用ユーティリティ (Domain計算式ではない)。 */
export function currentYearMonth(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** 年月セレクタ用の選択肢 (新しい→古い順, 当月を含めcount件) */
export function selectableYearMonths(count: number): string[] {
  const [yStr, mStr] = currentYearMonth().split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.UTC(y, m - 1 - i, 1));
    result.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return result;
}

/** 直近N months (古い→新しい順, targetYearMonthは含めない) */
export function recentYearMonths(targetYearMonth: string, count: number): string[] {
  const [yStr, mStr] = targetYearMonth.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const result: string[] = [];
  for (let i = count; i >= 1; i--) {
    const date = new Date(Date.UTC(y, m - 1 - i, 1));
    result.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return result;
}
