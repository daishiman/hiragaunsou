/**
 * RFC4180準拠の最小CSVパーサ (外部依存なし)。
 * ダブルクォート内のカンマ・改行・エスケープされた `""` を正しく扱う。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // 改行コードの揺れ(\r\n, \n, \r)を吸収
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];

    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  // 末尾行(改行なしでファイルが終わる場合)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/**
 * 必須ヘッダーの1項目。単一の列名、または「いずれか1つがあればよい」列名の配列
 * (例: 表記ゆれで「氏　名」「氏名」のどちらもありうる場合)。
 */
export type HeaderRequirement = string | readonly string[];

/**
 * ヘッダー行に必須列が名前で全て揃っているかを検証する。
 *
 * 帳票の出力元(ACELINK NX-CE / ITP-WEBServiceV3 / 車楽クラウド等)が列順を変えても
 * 取り込めるよう、位置(インデックス)ではなく列名の集合で判定する。逆に、想定した
 * 列名が1つでも見つからなければ、ベストエフォートで0や空文字として処理せず、
 * ここで打ち切って原因を特定できるメッセージを投げる。
 */
export function assertRequiredHeaders(
  rows: string[][],
  requirements: readonly HeaderRequirement[],
  sourceLabel: string,
): void {
  const header = rows[0] ?? [];
  const headerSet = new Set(header.map((h) => h.trim()));
  const missing = requirements
    .filter((requirement) => {
      const candidates = Array.isArray(requirement) ? requirement : [requirement as string];
      return !candidates.some((name) => headerSet.has(name));
    })
    .map((requirement) => (Array.isArray(requirement) ? requirement.join("または") : (requirement as string)));

  if (missing.length > 0) {
    const actual = header.filter((h) => h.trim() !== "").join(" / ") || "(見出しを読み取れませんでした)";
    throw new Error(
      `${sourceLabel}に想定した列が見つかりませんでした。見つからない列: ${missing.join("、")}。実際の見出し: ${actual}`,
    );
  }
}

/** ヘッダー行とデータ行から `{header: value}` のレコード配列を作る */
export function toRecords(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const [header, ...data] = rows as [string[], ...string[][]];
  return data.map((r) => {
    const record: Record<string, string> = {};
    header.forEach((h, idx) => {
      record[h] = r[idx] ?? "";
    });
    return record;
  });
}
