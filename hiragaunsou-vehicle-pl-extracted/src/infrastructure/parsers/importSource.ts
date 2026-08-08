/**
 * マスタ取込で「元データのどこを読んだか」を画面に出すための情報。
 *
 * 社内Excelは同じブックに12か月分のシートが入っており、どのシートを読んだかで
 * 金額が変わりうる。「取り込んだのに数字が思っていたのと違う」と言われたときに、
 * 画面を見るだけで原因(別の月のシートを読んでいた)にたどり着けるようにする。
 */
export interface ImportSourceInfo {
  kind: "excel" | "csv";
  /** Excelのとき、実際に読んだシート名 */
  sheetName?: string;
  /** シート見出し「令和N年M月」から復元した年月 (YYYY-MM)。読めなければ null */
  sheetYearMonth?: string | null;
  /** 指定された対象年月のシートが無く、別のシートで代用したときだけ入る */
  fallbackFromYearMonth?: string;
}

/**
 * 「2026-05の収支シート」のような、人が読める1行の説明を組み立てる。
 *
 * fallbackNote は「対象月のシートが無かったので別の月で代用した」ときに続けて出す一文。
 * なぜ別の月で問題ないのかは読む項目によって理由が違う(車両マスタは金額、運転者マスタは
 * 人事の対応)ため、画面側から渡してもらう。
 */
export function describeImportSource(
  source: ImportSourceInfo | undefined,
  options?: { fallbackNote?: string },
): string | null {
  if (!source) return null;
  if (source.kind === "csv") return "CSVから読み取りました。";

  const sheet = source.sheetName ? `シート「${source.sheetName}」` : "収支シート";
  const month = source.sheetYearMonth ? `(${source.sheetYearMonth}分)` : "";
  if (source.fallbackFromYearMonth) {
    return (
      `対象月 ${source.fallbackFromYearMonth} のシートがこのExcelに無かったため、` +
      `いちばん新しい${sheet}${month}から読み取りました。` +
      (options?.fallbackNote ?? "")
    );
  }
  return `${sheet}${month}から読み取りました。`;
}
