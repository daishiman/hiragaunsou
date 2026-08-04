import { unzipSync } from "fflate";
import { VEHICLE_PL_FIELDS, type VehiclePlField } from "../../domain/entities/VehiclePl";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";

/** Excelブック内で展開してよいXML等の合計サイズ。圧縮爆弾を避けるための上限。 */
const MAX_EXTRACTED_BYTES = 30 * 1024 * 1024;

/** 既存の「○月収支表」シートをそのまま取り込む際のパース結果。 */
export interface MonthlyPlWorkbookParseResult {
  sheetName: string;
  /** シート見出し「令和N年M月車両別収支表」から復元した年月 (YYYY-MM)。判別できない場合は null。 */
  sheetYearMonth: string | null;
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

    const rows = takeVehicleRows(table, headerIndex)
      .map(toVehiclePlRow)
      .filter((row): row is VehiclePlCalculated => row !== null);

    if (rows.length > 0) {
      candidates.push({
        sheetName: sheet.name,
        sheetYearMonth: readSheetYearMonth(table, headerIndex),
        rows,
      });
    }
  }

  if (candidates.length === 0) {
    throw new Error("「車番」から「損益」まで51列の収支表シートを検出できませんでした。");
  }

  if (!preferredYearMonth) return candidates[0]!;

  // 年度ブックには12か月分のシートが入っている。帳票見出しの「令和N年M月」が正本であり、
  // 一致するシートが無いまま先頭シートで代用すると、別の月の実績を指定月として保存してしまう
  // (例: 2026-08 を指定 → シート名だけを見て「8月収支表」= 令和7年8月 を取り込む)。
  // 見出しから年月を読めたブックでは、必ず突き合わせて一致しなければ失敗させる。
  const dated = candidates.filter((candidate) => candidate.sheetYearMonth !== null);
  if (dated.length > 0) {
    const matched = dated.find((candidate) => candidate.sheetYearMonth === preferredYearMonth);
    if (matched) return matched;
    const available = dated.map((candidate) => candidate.sheetYearMonth).join(" / ");
    throw new Error(
      `このExcelに対象年月 ${preferredYearMonth} のシートがありません。取込可能な年月: ${available}`,
    );
  }

  // 見出しに和暦が無いブック(単月の作業用ファイル等)は年を判断できない。
  // シート名の「○月」で照合し、それも無ければ唯一の候補に限って受け入れる。
  const month = Number(preferredYearMonth.slice(5, 7));
  const byName = candidates.find((candidate) =>
    candidate.sheetName.normalize("NFKC").startsWith(`${month}月`),
  );
  if (byName) return byName;
  if (candidates.length === 1) return candidates[0]!;
  throw new Error(
    `このExcelのどのシートが対象年月 ${preferredYearMonth} か判別できませんでした。シート名を「${month}月収支表」の形式にしてください。`,
  );
}

/**
 * 「車番」見出しより上の行にある「令和N年M月車両別収支表」から年月を復元する。
 * シート名(「1月収益表」のような表記ゆれや年をまたぐ年度ブック)より、
 * 帳票本体に書かれた和暦見出しの方が信頼できる。
 */
function readSheetYearMonth(table: string[][], headerIndex: number): string | null {
  const heading = table
    .slice(0, headerIndex)
    .map((row) => row.filter((cell) => cell !== undefined).join(""))
    .join(" ")
    .normalize("NFKC");
  const match = heading.match(/令和\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月/);
  if (!match) return null;
  const year = 2018 + Number(match[1]); // 令和1年 = 2019年
  return `${year}-${String(Number(match[2])).padStart(2, "0")}`;
}

/**
 * 見出し行の下から、車両行が終わるまでを切り出す。
 * 収支表シートは車両行のあとに「合計」「平均」、さらに空行を挟んで
 * 「【保有車両数】」と車種別台数のブロックが続くため、そこで打ち切らないと
 * 集計行が車両として取り込まれ、車種名の列に台数が入るなど列全体が崩れる。
 */
function takeVehicleRows(table: string[][], headerIndex: number): string[][] {
  const body = table.slice(headerIndex + 1);
  const end = body.findIndex(isDataRegionEnd);
  return end < 0 ? body : body.slice(0, end);
}

/**
 * 車両行の領域が終わったか判定する。true を返した行以降は一切取り込まない。
 *
 * 実データ(★運送収支表2025-2026_5月更新.xlsx / 8月収支表)での並びは以下:
 *   ... 車両行 ... / 「合計」 / 「平均」 / 空行 / 「【保有車両数】」 / 「10tW」…車種別台数 / 「合計」
 * row[0] が車番の列。車番は "8190" のような数字だけでなく "129　　1113" "385/100" のような
 * 複合表記もあり、空セル(row[0] === "" または undefined)は車両行の途中にも現れうる。
 */
function isDataRegionEnd(row: string[]): boolean {
  const key = (row[0] ?? "").normalize("NFKC").replace(/\s/g, "");
  // 空セルは車両行の途中にも現れるため、打ち切りの根拠にしない。
  if (key === "") return false;
  // 「合計」「平均」は車両行直後の集計行、「【保有車両数】」は台数ブロックの見出し。
  // どれも車両行より前には出現しないため、最初に現れた時点で以降をすべて捨てる。
  return AGGREGATE_ROW_KEYS.has(key) || key.startsWith("【");
}

/** 車両行の直後に現れる集計行の車番セル。これ以降は車両ではない。 */
const AGGREGATE_ROW_KEYS = new Set(["合計", "計", "総計", "平均", "平均値"]);

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
