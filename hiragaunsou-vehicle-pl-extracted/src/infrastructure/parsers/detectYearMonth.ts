import { parseCsv } from "./csvUtils";
import { decodeCp932 } from "./encoding";
import { listMonthlyPlSheets } from "./monthlyPlWorkbookParser";

/**
 * 「このファイルは何年何月分か」の判定結果。
 *
 * 社内のファイル名は毎月・年度ごとに変わり、年月が入っていないこともあるため、
 * 判定にファイル名は一切使わない。Excelは帳票見出しの和暦、CSVは日付列の中身だけを根拠にする。
 */
export interface YearMonthDetection {
  /** 中身から一意に決まった年月 (YYYY-MM)。決まらなければ null。 */
  yearMonth: string | null;
  /** 画面にそのまま出す判定根拠の一文。判定できなかった理由もここに入れる。 */
  basis: string;
  /** 中身に複数の年月があった場合の候補 (新しい順)。利用者が選び直すときの手がかり。 */
  candidates: string[];
}

/** 日付列とみなすのに必要な、値が日付として読めた行の割合。 */
const DATE_COLUMN_RATIO = 0.8;

/**
 * 日付列が複数あるときに、どれを「この帳票の月」の根拠にするかの優先順。
 * 売上モニタリストは積荷日・着日・計上日・請求日などを持ち、請求日だけ翌月にずれる行がある。
 * 実ファイル(2026年5月分)では計上日は2104件すべてが2026-05、請求日は104件が2026-06だった。
 */
const PREFERRED_DATE_COLUMNS = ["計上日", "積荷日", "日報記日", "課税対象日", "着日", "運行日", "日付"];

/** Excel(.xlsx)は ZIP なので先頭2バイトで見分ける。ここでも拡張子は見ない。 */
export function isXlsx(content: ArrayBuffer): boolean {
  const bytes = new Uint8Array(content);
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * ファイルの中身だけから対象年月を判定する。
 *
 * - Excel: 収支表シートの見出し「令和N年M月車両別収支表」から復元する(シート名には年が無い)。
 * - CSV: 日付が入っている列を探し、その年月の最頻値を採る。
 * - 中身に日付が一切無い帳票(給与集計表・車両別運行実績表)は null を返し、画面で利用者に選ばせる。
 */
export function detectYearMonth(content: ArrayBuffer): YearMonthDetection {
  return isXlsx(content) ? detectFromWorkbook(content) : detectFromCsv(content);
}

function detectFromWorkbook(content: ArrayBuffer): YearMonthDetection {
  let sheets: { sheetName: string; sheetYearMonth: string | null }[];
  try {
    sheets = listMonthlyPlSheets(content);
  } catch {
    // 収支表シートを持たないExcelもここに来る。取込本体のエラー処理に任せ、判定だけ諦める。
    return {
      yearMonth: null,
      basis: "Excelの中身から年月を読み取れませんでした。何年何月分として取り込むかを選んでください。",
      candidates: [],
    };
  }

  const dated = sheets.filter(
    (sheet): sheet is { sheetName: string; sheetYearMonth: string } => sheet.sheetYearMonth !== null,
  );
  if (dated.length === 0) {
    const names = sheets.map((sheet) => `「${sheet.sheetName}」`).join("、");
    return {
      yearMonth: null,
      basis: names
        ? `シート${names}の見出しに「令和◯年◯月」が見つからず、年月を判定できませんでした。何年何月分として取り込むかを選んでください。`
        : "Excelの中身から年月を読み取れませんでした。何年何月分として取り込むかを選んでください。",
      candidates: [],
    };
  }

  const candidates = [...new Set(dated.map((sheet) => sheet.sheetYearMonth))].sort().reverse();
  const newest = dated.reduce((a, b) => (b.sheetYearMonth > a.sheetYearMonth ? b : a));
  const label = describeYearMonth(newest.sheetYearMonth);
  if (candidates.length === 1) {
    return {
      yearMonth: newest.sheetYearMonth,
      basis: `シート「${newest.sheetName}」の見出しに書かれた年月から、${label}分と判定しました。`,
      candidates,
    };
  }
  return {
    yearMonth: newest.sheetYearMonth,
    basis: `このExcelには ${candidates.join(" / ")} の収支表シートが入っています。いちばん新しい${label}分を初期値にしました。違う月ならここで選び直してください。`,
    candidates,
  };
}

function detectFromCsv(content: ArrayBuffer): YearMonthDetection {
  let rows: string[][];
  try {
    rows = parseCsv(decodeCp932(content));
  } catch {
    rows = [];
  }
  const header = rows[0] ?? [];
  const body = rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (header.length === 0 || body.length === 0) {
    return {
      yearMonth: null,
      basis: "ファイルの中身を読み取れませんでした。何年何月分として取り込むかを選んでください。",
      candidates: [],
    };
  }

  const column = findDateColumn(header, body);
  if (!column) {
    return {
      yearMonth: null,
      basis:
        "この帳票には日付が書かれていないため、中身から年月を判定できません。何年何月分として取り込むかを選んでください。",
      candidates: [],
    };
  }

  const counts = new Map<string, number>();
  for (const row of body) {
    const ym = toYearMonth(row[column.index] ?? "");
    if (ym) counts.set(ym, (counts.get(ym) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [dominant, dominantCount] = sorted[0]!;
  const matched = [...counts.values()].reduce((sum, n) => sum + n, 0);
  return {
    yearMonth: dominant,
    basis: `「${column.name}」の日付${matched}件のうち${dominantCount}件が${describeYearMonth(dominant)}だったので、${describeYearMonth(dominant)}分と判定しました。`,
    candidates: sorted.map(([ym]) => ym),
  };
}

/** 日付として読める値が大半を占める列を探す。見出しの名前ではなく中身の形で判定する。 */
function findDateColumn(header: string[], body: string[][]): { index: number; name: string } | null {
  const found: { index: number; name: string }[] = [];
  for (let index = 0; index < header.length; index += 1) {
    let dates = 0;
    let filled = 0;
    for (const row of body) {
      const value = (row[index] ?? "").trim();
      if (value === "") continue;
      filled += 1;
      if (toYearMonth(value)) dates += 1;
    }
    if (filled > 0 && dates / filled >= DATE_COLUMN_RATIO) {
      found.push({ index, name: (header[index] ?? "").trim() || `${index + 1}列目` });
    }
  }
  if (found.length === 0) return null;
  for (const name of PREFERRED_DATE_COLUMNS) {
    const preferred = found.find((column) => column.name === name);
    if (preferred) return preferred;
  }
  return found[0]!;
}

/** "2026/05/01" "2026-5-1" "2026年5月1日" などから YYYY-MM を取り出す。読めなければ null。 */
function toYearMonth(value: string): string | null {
  const match = /^(\d{4})[-/年](\d{1,2})[-/月]/.exec(value.trim().normalize("NFKC"));
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${String(month).padStart(2, "0")}`;
}

/** YYYY-MM を「2026年5月」の業務の言葉にする。画面の判定根拠に使う。 */
export function describeYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return `${year}年${Number(month)}月`;
}
