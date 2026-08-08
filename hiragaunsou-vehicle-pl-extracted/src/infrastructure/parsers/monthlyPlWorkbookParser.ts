import { unzipSync } from "fflate";
import { VEHICLE_PL_FIELDS, type VehiclePlField } from "../../domain/entities/VehiclePl";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";

/** Excelブック内で展開してよいXML等の合計サイズ。圧縮爆弾を避けるための上限。 */
const MAX_EXTRACTED_BYTES = 30 * 1024 * 1024;

/**
 * 収支表51列(VEHICLE_PL_FIELDS)それぞれが、見出し行でどう表記されるか。
 * 実データ2件(★車両別収支計算用2026年5月.xlsx / 運送収支表2025-2026 5月更新.xlsx)を
 * 突き合わせたところ、列順・表記は51列とも一致していたが「fee」列だけ
 * 「高速他料金」「附帯料金」の2表記が実在したため、両方を許容する。
 * ここに無い表記は未知の列名として扱い、取込を中断する(あいまい一致で救わない)。
 */
export const FIELD_HEADER_NAMES: Record<VehiclePlField, readonly string[]> = {
  no: ["車番"],
  type: ["車種名"],
  depot: ["所属"],
  reg: ["初年度登録"],
  code: ["コード"],
  driver: ["運転者名"],
  trips: ["運行回数"],
  slips: ["伝票件数"],
  hours: ["稼働時間"],
  km: ["稼働Ｋｍ"],
  fare: ["運賃"],
  fee: ["高速他料金", "附帯料金"],
  sales: ["運送収入　　（運賃＋料金）"],
  toll: ["道路使用料"],
  tollDisc: ["高速割引料"],
  tollNet: ["※運行費計"],
  fuelIn: ["軽油代　　　　　　　　インタンク"],
  fuelInQty: ["インタンク　給油量"],
  fuelOut: ["軽油代　　　　　外部"],
  fuelOutQty: ["外部　　　　　　給油量"],
  fuelQty: ["給油量　　　　　合計"],
  nempi: ["燃費"],
  adblue: ["外部アドブルー"],
  fuelTotal: ["※燃料費計"],
  repair: ["修理費"],
  tire: ["タイヤ費"],
  equip: ["備品費"],
  mainte: ["メンテ　　　　　（委託）"],
  repairTotal: ["※修繕費計"],
  salary: ["給与"],
  bonus: ["賞与"],
  welfare: ["福利厚生費"],
  laborTotal: ["※人件費計"],
  insCompulsory: ["自賠責保険"],
  insVoluntary: ["任意保険"],
  insTotal: ["※保険料計"],
  taxAuto: ["自動車税"],
  taxWeight: ["自動車重量税"],
  taxTotal: ["※賦課税計"],
  miscOther: ["その他諸経費"],
  miscTotal: ["※諸経費計"],
  lease: ["車両リース費"],
  installment: ["車両割賦支払費"],
  transportTotal: ["※運送費計"],
  adminFee: ["一般管理費"],
  adminTotal: ["※管理費計"],
  fixed: ["固定費"],
  variable: ["変動費"],
  expense: ["経費計"],
  profit: ["損益"],
  margin: ["利益率"],
};

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
 * ファイル名・シート名ではなく、見出し行に「車番」「損益」に相当する列名があるかで対象シートを
 * 検出するため、月替わりのファイル名や年度ブックにも対応する。列の位置(インデックス)には依存せず
 * 全51列を名前で解決するため、列の並び順が変わっても、未知の列が追加されていても取り込める。
 * 想定した列名が見つからない場合はベストエフォートで補完せず、原因を特定できる例外を投げて止める。
 * xlsx の数式は実行せず、Excelが保存したキャッシュ値だけを読む。未計算のブックはExcelで
 * 再計算・保存してから再取込する必要がある。
 */
/**
 * 対象年月のシートが見つからなかったときの振る舞い。
 *
 * "throw" (既定): 月次収支表の取込。指定月の実績として別の月を保存すると数字が黙って狂うため、
 *   一致しなければ必ず失敗させる。
 * "useLatest": マスタの取込。保険・税・リース料は「その月の実績」ではなく車両そのものの属性で、
 *   どの月のシートから読んでも同じ値が入る。ここで失敗させると、8月に前月分(6月)を既定として
 *   選んでいる画面から5月までしか無いブックを取り込めない、という理由の分かりにくい行き止まりになる。
 *   代わりにいちばん新しい月のシートを使い、どのシートを読んだかを呼び出し側が画面に出す。
 */
export type YearMonthMismatchPolicy = "throw" | "useLatest";

export function parseMonthlyPlWorkbook(
  input: ArrayBuffer | Uint8Array,
  preferredYearMonth?: string,
  onYearMonthMismatch: YearMonthMismatchPolicy = "throw",
): MonthlyPlWorkbookParseResult {
  const candidates = collectSheetCandidates(input, preferredYearMonth);

  if (candidates.length === 0) {
    throw new Error("「車番」から「損益」まで51列の収支表シートを検出できませんでした。");
  }

  if (!preferredYearMonth) return candidates[0]!;

  // 対象年月と一致するシートが見つかった時点で走査を打ち切っているため、末尾が一致シート。
  const lastCandidate = candidates[candidates.length - 1]!;
  if (lastCandidate.sheetYearMonth === preferredYearMonth) return lastCandidate;

  // 年度ブックには12か月分のシートが入っている。帳票見出しの「令和N年M月」が正本であり、
  // 一致するシートが無いまま先頭シートで代用すると、別の月の実績を指定月として保存してしまう
  // (例: 2026-08 を指定 → シート名だけを見て「8月収支表」= 令和7年8月 を取り込む)。
  // 見出しから年月を読めたブックでは、必ず突き合わせて一致しなければ失敗させる。
  const dated = candidates.filter((candidate) => candidate.sheetYearMonth !== null);
  if (dated.length > 0) {
    if (onYearMonthMismatch === "useLatest") {
      return dated.reduce((newest, candidate) =>
        candidate.sheetYearMonth! > newest.sheetYearMonth! ? candidate : newest,
      );
    }
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
  // マスタ取込は「どの月のシートでも同じ値が入る」ため、判別できなくても止めない。
  // どのシートを読んだかは呼び出し側が sheetName を画面に出して人に確かめてもらう。
  if (onYearMonthMismatch === "useLatest") return candidates[0]!;
  throw new Error(
    `このExcelのどのシートが対象年月 ${preferredYearMonth} か判別できませんでした。シート名を「${month}月収支表」の形式にしてください。`,
  );
}

/**
 * このブックに入っている収支表シートと、その見出しから読み取れた年月の一覧。
 *
 * 取込画面が「このファイルは何年何月分か」をファイル名ではなく中身から提示するために使う。
 * 年月が読み取れなかったシートは sheetYearMonth が null になり、画面は利用者に年月を選ばせる。
 */
export function listMonthlyPlSheets(
  input: ArrayBuffer | Uint8Array,
): { sheetName: string; sheetYearMonth: string | null }[] {
  return collectSheetCandidates(input).map(({ sheetName, sheetYearMonth }) => ({
    sheetName,
    sheetYearMonth,
  }));
}

/**
 * 51列の収支表シートを、ブックの先頭から順に集める。
 * stopAtYearMonth と一致するシートに当たったらそこで打ち切る(末尾が一致シートになる)。
 */
function collectSheetCandidates(
  input: ArrayBuffer | Uint8Array,
  stopAtYearMonth?: string,
): MonthlyPlWorkbookParseResult[] {
  const bytes = toUint8Array(input);
  let extractedBytes = 0;

  /**
   * 指定パスだけを展開する。fflate の unzipSync は filter で対象外のエントリを
   * 「展開自体しない」(zh() でメタ情報を見てから inflate をスキップする)ため、
   * 収支表シート以外(実データでは売上モニタリスト等の生データシートが数MB単位である)
   * を毎回展開してしまう既存実装のCPUコストを避けられる。
   */
  function extract(paths: Set<string>): Record<string, Uint8Array> {
    let out: Record<string, Uint8Array>;
    try {
      out = unzipSync(bytes, { filter: (file) => paths.has(file.name) });
    } catch {
      throw new Error("Excel（.xlsx）として読み取れません。xlsx形式のファイルを選択してください。");
    }
    for (const file of Object.values(out)) extractedBytes += file.byteLength;
    if (extractedBytes > MAX_EXTRACTED_BYTES) {
      throw new Error("展開後のExcelデータが30MBを超えています。ファイルを分割して再度取り込んでください。");
    }
    return out;
  }

  const metaFiles = extract(new Set(["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml"]));
  const workbookXml = readXml(metaFiles, "xl/workbook.xml");
  const relationshipsXml = readXml(metaFiles, "xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relationshipsXml) {
    throw new Error("Excelブックの構成を読み取れませんでした。");
  }

  const sharedStrings = parseSharedStrings(readXml(metaFiles, "xl/sharedStrings.xml"));
  const relationshipTargets = parseRelationshipTargets(relationshipsXml);
  const sheets = parseSheets(workbookXml);

  const candidates: MonthlyPlWorkbookParseResult[] = [];
  for (const sheet of sheets) {
    const target = relationshipTargets.get(sheet.relationshipId);
    if (!target) continue;
    const path = resolveSheetPath(target);
    const sheetFiles = extract(new Set([path]));
    const sheetXml = readXml(sheetFiles, path);
    if (!sheetXml) continue;

    const table = parseSheetRows(sheetXml, sharedStrings);
    const located = locateHeader(table, sheet.name);
    if (!located) continue;
    const { headerIndex, columns } = located;

    const rows = takeVehicleRows(table, headerIndex, columns.no)
      .map((row) => toVehiclePlRow(row, columns))
      .filter((row): row is VehiclePlCalculated => row !== null);

    if (rows.length > 0) {
      const candidate: MonthlyPlWorkbookParseResult = {
        sheetName: sheet.name,
        sheetYearMonth: readSheetYearMonth(table, headerIndex),
        rows,
      };
      candidates.push(candidate);

      // 対象年月が一致するシートが見つかった時点で確定してよい。以降のシートを
      // 展開・正規表現パースする必要はない(1シートあたり数百KB〜数MBあり、
      // 無関係シートの解析を続けるだけでCPU時間の大半を消費してしまう)。
      if (stopAtYearMonth && candidate.sheetYearMonth === stopAtYearMonth) {
        return candidates;
      }
    }
  }

  return candidates;
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
function takeVehicleRows(table: string[][], headerIndex: number, noColumnIndex: number): string[][] {
  const body = table.slice(headerIndex + 1);
  const end = body.findIndex((row) => isDataRegionEnd(row, noColumnIndex));
  return end < 0 ? body : body.slice(0, end);
}

/**
 * 車両行の領域が終わったか判定する。true を返した行以降は一切取り込まない。
 *
 * 実データ(★運送収支表2025-2026_5月更新.xlsx / 8月収支表)での並びは以下:
 *   ... 車両行 ... / 「合計」 / 「平均」 / 空行 / 「【保有車両数】」 / 「10tW」…車種別台数 / 「合計」
 * noColumnIndex は見出し行を名前解決して求めた「車番」列の位置(列順が変わっても追従する)。
 * 車番は "8190" のような数字だけでなく "129　　1113" "385/100" のような複合表記もあり、
 * 空セル(該当列が "" または undefined)は車両行の途中にも現れうる。
 */
function isDataRegionEnd(row: string[], noColumnIndex: number): boolean {
  const key = (row[noColumnIndex] ?? "").normalize("NFKC").replace(/\s/g, "");
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

/**
 * 行・セルの走査。
 *
 * Excelは「書式だけ設定された空セル」を `<c r="AB4" s="18"/>` の自己終了タグで保存する
 * (実データの収支表では、未入力の「メンテ(委託)」「車両リース費」列がまさにこの形)。
 * `</c>` を必須にした正規表現ではこれにマッチできず、`<c r="AB4" s="18"/` を開始タグと
 * 誤認して次のセルの `<v>` を空セルの値として取り込み、本来のセルを丸ごと落としてしまう
 * (メンテ費に修繕費計の額が入り、修繕費計が0になる、という実害が出ていた)。
 * 閉じタグ形式と自己終了形式の両方を1つの正規表現で受けるため、`\/>` の分岐を明示する。
 * 中身が空の行 `<row .../>` も同じ理由で自己終了を許す。
 */
function parseSheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
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

function normalizeHeader(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s/g, "").replace(/^\uFEFF/, "");
}

/** 見出し行1行分を、正規化した見出しテキスト → 出現した列位置一覧、に変換する。 */
function buildCellIndex(row: string[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  row.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (key === "") return;
    const existing = map.get(key);
    if (existing) existing.push(index);
    else map.set(key, [index]);
  });
  return map;
}

/** この行に「車番」「損益」に相当する見出しが(位置に関わらず)両方含まれるか。見出し行の当たりを付けるための緩い判定。 */
function looksLikeMonthlyPlHeader(cellIndex: Map<string, number[]>): boolean {
  const hasNo = FIELD_HEADER_NAMES.no.some((name) => cellIndex.has(normalizeHeader(name)));
  const hasProfit = FIELD_HEADER_NAMES.profit.some((name) => cellIndex.has(normalizeHeader(name)));
  return hasNo && hasProfit;
}

/**
 * 見出し行の全列を名前で51列(VEHICLE_PL_FIELDS)に突き合わせる。
 * 列の並び順が変わっていても、列名さえ一致すれば解決できる。列が追加されていても、
 * 見出しに無い未知の列としてそのまま無視する。
 *
 * 想定した列名が1つでも見つからない、または同名の列が複数あって一意に決められない場合は、
 * 担当者が元ファイルを見て原因を特定できるよう、欲しい列名と実際の見出し一覧を含めて例外を投げる。
 * ベストエフォートでの位置補完やあいまい一致は行わない。
 */
function resolveColumns(
  cellIndex: Map<string, number[]>,
  sheetName: string,
  headerRow: string[],
): Record<VehiclePlField, number> {
  const columns = {} as Record<VehiclePlField, number>;
  const missing: string[] = [];
  const ambiguous: string[] = [];

  for (const field of VEHICLE_PL_FIELDS) {
    const aliases = FIELD_HEADER_NAMES[field];
    const matchedAlias = aliases.find((alias) => cellIndex.has(normalizeHeader(alias)));
    if (!matchedAlias) {
      missing.push(aliases.join("／"));
      continue;
    }
    const indices = cellIndex.get(normalizeHeader(matchedAlias))!;
    if (indices.length > 1) {
      ambiguous.push(`${matchedAlias}(${indices.length}箇所)`);
      continue;
    }
    columns[field] = indices[0]!;
  }

  if (missing.length > 0 || ambiguous.length > 0) {
    const actualHeaders =
      headerRow.filter((cell) => normalizeHeader(cell) !== "").join(" / ") || "(見出しを読み取れませんでした)";
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`見つからない列: ${missing.join("、")}`);
    if (ambiguous.length > 0) parts.push(`同名の列が複数あり判別できない列: ${ambiguous.join("、")}`);
    throw new Error(
      `シート「${sheetName}」の収支表見出し行が想定と一致しませんでした。${parts.join(" ")}。実際の見出し: ${actualHeaders}`,
    );
  }

  return columns;
}

/**
 * シート内から収支表の見出し行を探し、51列の名前解決結果とともに返す。
 * 「車番」「損益」に相当する見出しが両方見つかった行を対象シートの見出し行とみなし、
 * そこで51列の突き合わせに失敗した場合は(他の行を探して救わず)例外を投げて中断する。
 * 「車番」「損益」自体が見当たらない = このシートは収支表ではない、とみなしてシートをスキップする(null)。
 */
function locateHeader(
  table: string[][],
  sheetName: string,
): { headerIndex: number; columns: Record<VehiclePlField, number> } | null {
  for (let index = 0; index < table.length; index++) {
    const row = table[index]!;
    const cellIndex = buildCellIndex(row);
    if (!looksLikeMonthlyPlHeader(cellIndex)) continue;
    return { headerIndex: index, columns: resolveColumns(cellIndex, sheetName, row) };
  }
  return null;
}

function toVehiclePlRow(cells: string[], columns: Record<VehiclePlField, number>): VehiclePlCalculated | null {
  const no = normalizeKey(cells[columns.no]);
  if (!no || no === "合計") return null;

  const values = Object.fromEntries(
    VEHICLE_PL_FIELDS.map((field) => [field, cells[columns[field]] ?? ""]),
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
