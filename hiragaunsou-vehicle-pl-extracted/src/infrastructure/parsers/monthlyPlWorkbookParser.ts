import { unzipSync } from "fflate";
import { VEHICLE_PL_FIELDS, type VehiclePlField } from "../../domain/entities/VehiclePl";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";

/** Excelブック内で展開してよいXML等の合計サイズ。圧縮爆弾を避けるための上限。 */
const MAX_EXTRACTED_BYTES = 30 * 1024 * 1024;

/** 既存の「○月収支表」シートをそのまま取り込む際のパース結果。 */
export interface MonthlyPlWorkbookParseResult {
  sheetName: string;
  rows: VehiclePlCalculated[];
}

/**
 * Excel (.xlsx) の保存済み計算結果を、車両別収支表の51列に変換する。
 *
 * ファイル名・シート名ではなく、見出し行の「車番」と50列目の「損益」で対象を検出するため、
 * 月替わりのファイル名や年度ブックにも対応する。xlsx の数式は実行せず、Excelが保存した
 * キャッシュ値だけを読む。未計算のブックはExcelで再計算・保存してから再取込する必要がある。
 */
export function parseMonthlyPlWorkbook(
  input: ArrayBuffer | Uint8Array,
  preferredYearMonth?: string,
): MonthlyPlWorkbookParseResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(toUint8Array(input));
  } catch {
    throw new Error("Excel（.xlsx）として読み取れません。xlsx形式のファイルを選択してください。");
  }

  const extractedBytes = Object.values(files).reduce((total, file) => total + file.byteLength, 0);
  if (extractedBytes > MAX_EXTRACTED_BYTES) {
    throw new Error("展開後のExcelデータが30MBを超えています。ファイルを分割して再度取り込んでください。");
  }

  const workbookXml = readXml(files, "xl/workbook.xml");
  const relationshipsXml = readXml(files, "xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relationshipsXml) {
    throw new Error("Excelブックの構成を読み取れませんでした。");
  }

  const sharedStrings = parseSharedStrings(readXml(files, "xl/sharedStrings.xml"));
  const relationshipTargets = parseRelationshipTargets(relationshipsXml);
  const sheets = parseSheets(workbookXml);

  const candidates: MonthlyPlWorkbookParseResult[] = [];
  for (const sheet of sheets) {
    const target = relationshipTargets.get(sheet.relationshipId);
    if (!target) continue;
    const path = resolveSheetPath(target);
    const sheetXml = readXml(files, path);
    if (!sheetXml) continue;

    const table = parseSheetRows(sheetXml, sharedStrings);
    const headerIndex = table.findIndex(isMonthlyPlHeader);
    if (headerIndex < 0) continue;

    const rows = table
      .slice(headerIndex + 1)
      .map(toVehiclePlRow)
      .filter((row): row is VehiclePlCalculated => row !== null);

    if (rows.length > 0) candidates.push({ sheetName: sheet.name, rows });
  }

  if (candidates.length > 0) {
    const month = preferredYearMonth?.match(/^\d{4}-(\d{2})$/)?.[1];
    if (month) {
      const monthPrefix = `${Number(month)}月`;
      const preferred = candidates.find((candidate) => candidate.sheetName.normalize("NFKC").startsWith(monthPrefix));
      if (preferred) return preferred;
    }
    return candidates[0]!;
  }

  throw new Error("「車番」から「損益」まで51列の収支表シートを検出できませんでした。");
}

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function readXml(files: Record<string, Uint8Array>, path: string): string | null {
  const value = files[path];
  return value ? new TextDecoder().decode(value) : null;
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => textFromXml(match[1] ?? ""));
}

function parseRelationshipTargets(xml: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)) {
    const id = attribute(match[1] ?? "", "Id");
    const target = attribute(match[1] ?? "", "Target");
    if (id && target) targets.set(id, target);
  }
  return targets;
}

function parseSheets(xml: string): { name: string; relationshipId: string }[] {
  const sheets: { name: string; relationshipId: string }[] = [];
  for (const match of xml.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/g)) {
    const name = attribute(match[1] ?? "", "name");
    const relationshipId = attribute(match[1] ?? "", "r:id");
    if (name && relationshipId) sheets.push({ name, relationshipId });
  }
  return sheets;
}

function resolveSheetPath(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return `xl/${target.replace(/^\.\//, "")}`;
}

function parseSheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = attribute(cellMatch[1] ?? "", "r");
      if (!ref) continue;
      const column = columnIndex(ref);
      cells[column] = cellValue(cellMatch[1] ?? "", cellMatch[2] ?? "", sharedStrings);
    }
    rows.push(cells);
  }
  return rows;
}

function cellValue(attributes: string, body: string, sharedStrings: string[]): string {
  const type = attribute(attributes, "t");
  if (type === "inlineStr") return textFromXml(body);
  const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (type === "s") return sharedStrings[Number(raw)] ?? "";
  return decodeXml(raw);
}

function textFromXml(xml: string): string {
  // Excelはふりがな(rPh)も<t>で持つ。帳票見出しの判定値に混ぜない。
  const withoutPhonetic = xml.replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
  return [...withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1] ?? ""))
    .join("");
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attribute(attributes: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return attributes.match(new RegExp(`${escaped}="([^"]*)"`))?.[1] ?? null;
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0];
  if (!letters) return 0;
  return [...letters.toUpperCase()].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function isMonthlyPlHeader(row: string[]): boolean {
  return normalizeHeader(row[0]) === "車番" && normalizeHeader(row[49]) === "損益" && row.length >= 51;
}

function normalizeHeader(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s/g, "").replace(/^\uFEFF/, "");
}

function toVehiclePlRow(cells: string[]): VehiclePlCalculated | null {
  const no = normalizeKey(cells[0]);
  if (!no || no === "合計") return null;

  const values = Object.fromEntries(
    VEHICLE_PL_FIELDS.map((field, index) => [field, cells[index] ?? ""]),
  ) as Record<VehiclePlField, string>;

  return {
    no,
    type: textValue(values.type) ?? "",
    depot: textValue(values.depot) ?? "",
    reg: registrationValue(values.reg),
    code: textValue(values.code),
    driver: textValue(values.driver),
    trips: numberValue(values.trips),
    slips: numberValue(values.slips),
    hours: numberValue(values.hours),
    km: numberValue(values.km),
    fare: numberValue(values.fare),
    fee: numberValue(values.fee),
    sales: numberValue(values.sales),
    toll: numberValue(values.toll),
    tollDisc: numberValue(values.tollDisc),
    tollNet: numberValue(values.tollNet),
    fuelIn: numberValue(values.fuelIn),
    fuelInQty: numberValue(values.fuelInQty),
    fuelOut: numberValue(values.fuelOut),
    fuelOutQty: numberValue(values.fuelOutQty),
    fuelQty: numberValue(values.fuelQty),
    nempi: numberValue(values.nempi),
    adblue: numberValue(values.adblue),
    fuelTotal: numberValue(values.fuelTotal),
    repair: numberValue(values.repair),
    repairStandard: 0,
    tire: numberValue(values.tire),
    equip: numberValue(values.equip),
    mainte: numberValue(values.mainte),
    repairTotal: numberValue(values.repairTotal),
    salary: numberValue(values.salary),
    bonus: numberValue(values.bonus),
    welfare: numberValue(values.welfare),
    laborTotal: numberValue(values.laborTotal),
    insCompulsory: numberValue(values.insCompulsory),
    insVoluntary: numberValue(values.insVoluntary),
    insTotal: numberValue(values.insTotal),
    taxAuto: numberValue(values.taxAuto),
    taxWeight: numberValue(values.taxWeight),
    taxTotal: numberValue(values.taxTotal),
    miscOther: numberValue(values.miscOther),
    miscTotal: numberValue(values.miscTotal),
    lease: numberValue(values.lease),
    installment: numberValue(values.installment),
    transportTotal: numberValue(values.transportTotal),
    adminFee: numberValue(values.adminFee),
    adminTotal: numberValue(values.adminTotal),
    fixed: numberValue(values.fixed),
    variable: numberValue(values.variable),
    expense: numberValue(values.expense),
    profit: numberValue(values.profit),
    margin: numberValue(values.margin),
  };
}

function normalizeKey(value: string | undefined): string {
  const normalized = (value ?? "").trim().normalize("NFKC");
  return /^\d+(?:\.0+)?$/.test(normalized) ? normalized.replace(/\.0+$/, "") : normalized;
}

function textValue(value: string | undefined): string | null {
  const normalized = (value ?? "").trim();
  return normalized === "" ? null : normalized;
}

function numberValue(value: string | undefined): number {
  const normalized = (value ?? "").replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function registrationValue(value: string | undefined): string | null {
  const raw = textValue(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7);
  const serial = Number(raw);
  if (!Number.isFinite(serial) || serial < 25_000 || serial > 80_000) return raw;
  const excelEpoch = Date.UTC(1899, 11, 30);
  const date = new Date(excelEpoch + serial * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
