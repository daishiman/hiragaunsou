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
