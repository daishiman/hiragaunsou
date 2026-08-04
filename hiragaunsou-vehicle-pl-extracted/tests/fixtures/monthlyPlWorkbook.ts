import { strToU8, zipSync } from "fflate";
import { VEHICLE_PL_FIELDS, type VehiclePlField } from "../../src/domain/entities/VehiclePl";
import { FIELD_HEADER_NAMES } from "../../src/infrastructure/parsers/monthlyPlWorkbookParser";

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineCell(ref: string, value: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function numberCell(ref: string, value: number): string {
  return `<c r="${ref}"><v>${value}</v></c>`;
}

function rowXml(rowNumber: number, values: (string | number)[]): string {
  return `<row r="${rowNumber}">${values.map((value, index) => (
    typeof value === "number"
      ? numberCell(`${columnName(index)}${rowNumber}`, value)
      : inlineCell(`${columnName(index)}${rowNumber}`, value)
  )).join("")}</row>`;
}

export interface MonthlyPlWorkbookFixtureOptions {
  /** 収支表に並べる列の順序。省略時は VEHICLE_PL_FIELDS の順。列順を入れ替えるテストで使う。 */
  fieldOrder?: readonly VehiclePlField[];
  /** 見出し行から取り除く列。必須列が1つ欠けているケースを再現するテストで使う。 */
  omitFields?: readonly VehiclePlField[];
  /** 特定の列だけ見出しテキストを差し替える。想定外の表記のケースを再現するテストで使う。 */
  headerOverrides?: Partial<Record<VehiclePlField, string>>;
  /** 「合計」集計行を出力しない。車両行の下に集計ブロックが無いケースを再現するテストで使う。 */
  omitAggregateRow?: boolean;
  /** シート名。省略時は "5月収支表"。シート名と対象年月の照合ロジックを検証するテストで使う。 */
  sheetName?: string;
}

/** テスト用の最小xlsx。車番10は諸口・重複候補、88888は傭車として使う。 */
export function buildMonthlyPlWorkbookFixture(options: MonthlyPlWorkbookFixtureOptions = {}): Uint8Array {
  const omit = new Set(options.omitFields ?? []);
  const fields = (options.fieldOrder ?? VEHICLE_PL_FIELDS).filter((field) => !omit.has(field));

  const headers = fields.map((field) => options.headerOverrides?.[field] ?? FIELD_HEADER_NAMES[field][0]!);

  const firstValues: Partial<Record<VehiclePlField, string | number>> = {
    no: 10,
    type: "大型",
    depot: "本社",
    reg: 44256,
    code: "E001",
    driver: "諸口",
    trips: 12,
    sales: 500000,
    fuelTotal: 120000,
    repair: 25000,
    expense: 420000,
    profit: 80000,
    margin: 0.16,
  };
  const first = fields.map((field): string | number => {
    if (field in firstValues) return firstValues[field]!;
    return 0;
  });

  const chartered = fields.map((field): string | number => {
    if (field === "no") return 88888;
    if (field === "driver") return "傭車";
    return 0;
  });

  const aggregateRow = options.omitAggregateRow ? "" : rowXml(6, ["合計"]);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>${rowXml(3, headers)}${rowXml(4, first)}${rowXml(5, chartered)}${aggregateRow}</sheetData>
    </worksheet>`;
  const sheetName = options.sheetName ?? "5月収支表";
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
    </workbook>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    </Relationships>`;
  return zipSync({
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(relationships),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
}
