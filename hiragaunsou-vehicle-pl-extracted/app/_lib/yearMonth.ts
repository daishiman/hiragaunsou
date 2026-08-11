const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface JstCalendarMonth {
  /** 日本時間で見た暦月。業務データの対象年月とは別の概念。 */
  yearMonth: string;
  /** その暦月の1日 00:00:00（日本時間）を表すepoch milliseconds。 */
  startsAtMs: number;
}

/** 指定時刻が属する日本時間の暦月と、その月初を返す。 */
export function getJstCalendarMonth(now: Date): JstCalendarMonth {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const monthIndex = jst.getUTCMonth();
  const m = String(monthIndex + 1).padStart(2, "0");
  return {
    yearMonth: `${y}-${m}`,
    startsAtMs: Date.UTC(y, monthIndex, 1) - JST_OFFSET_MS,
  };
}

/** 現在の年月を YYYY-MM (JST基準) で返す。Presentation層の表示用ユーティリティ (Domain計算式ではない)。 */
export function currentYearMonth(): string {
  return getJstCalendarMonth(new Date()).yearMonth;
}

/**
 * 取込画面の既定年月。当月ではなく前月を返す。
 * 収支表は締め後に作るため、当月分の元データはまだ揃っていない。
 * 既定を当月にすると「2026-08を指定して令和7年8月シートを取り込む」ような
 * 年月の取り違えを誘発するため、実務上ありうる月を初期値にする。
 */
export function defaultImportYearMonth(): string {
  const [yStr, mStr] = currentYearMonth().split("-");
  const date = new Date(Date.UTC(Number(yStr), Number(mStr) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** YYYY-MM 形式かどうか (画面から渡る年月の検証用) */
export function isYearMonth(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
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

/** 対象月からnヶ月前の年月 (n=0 は同じ月) */
export function monthsBefore(yearMonth: string, n: number): string {
  const [yStr, mStr] = yearMonth.split("-");
  const date = new Date(Date.UTC(Number(yStr), Number(mStr) - 1 - n, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * ダッシュボードの期間プリセット。
 * 締めの終わった月を見るのが実務なので、基準は当月ではなく前月にする。
 */
export function periodPresets(): { label: string; from: string; to: string }[] {
  const to = defaultImportYearMonth();
  return [
    { label: "単月", from: to, to },
    { label: "3ヶ月", from: monthsBefore(to, 2), to },
    { label: "6ヶ月", from: monthsBefore(to, 5), to },
    // 1年前の同月と当月を並べて見比べられるよう、12ではなく13ヶ月にする
    { label: "13ヶ月", from: monthsBefore(to, 12), to },
  ];
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
