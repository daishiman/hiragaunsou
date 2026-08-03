import { strToU8, zipSync } from "fflate";
import { VEHICLE_PL_FIELDS } from "../../src/domain/entities/VehiclePl";

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

/** テスト用の最小xlsx。車番10は諸口・重複候補、88888は傭車として使う。 */
export function buildMonthlyPlWorkbookFixture(): Uint8Array {
  const headers = VEHICLE_PL_FIELDS.map((field, index) => {
    if (index === 0) return "車番";
    if (index === 49) return "損益";
    if (index === 50) return "利益率";
    return field;
  });
  const first = VEHICLE_PL_FIELDS.map((field, index): string | number => {
    const values: Partial<Record<(typeof VEHICLE_PL_FIELDS)[number], string | number>> = {
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
    return values[field] ?? (index < 6 ? "" : 0);
  });
  const chartered = VEHICLE_PL_FIELDS.map((field, index): string | number => {
    if (field === "no") return 88888;
    if (field === "driver") return "傭車";
    return index < 6 ? "" : 0;
  });
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>${rowXml(3, headers)}${rowXml(4, first)}${rowXml(5, chartered)}${rowXml(6, ["合計"])}</sheetData>
    </worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="5月収支表" sheetId="1" r:id="rId1"/></sheets>
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
