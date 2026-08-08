import { assertRequiredHeaders, parseCsv, toRecords } from "./csvUtils";
import { decodeCp932 } from "./encoding";
import { parseMonthlyPlWorkbook } from "./monthlyPlWorkbookParser";
import { parseJapaneseAmount, normalizeKey, splitCompositeVehicleNo } from "./numberUtils";
import type { ImportSourceInfo } from "./importSource";
import { TRAILER_VEHICLE_TYPE_PATTERN } from "../../domain/rules/towedVehicle";

/** 列順が変わっても取り込めるよう、名前で検証する必須列。 */
export const REQUIRED_HEADERS = [
  "車番",
  "車種名",
  "所属",
  "自賠責保険",
  "任意保険",
  "自動車税",
  "自動車重量税",
  "車両リース費",
  "車両割賦支払費",
] as const;

/** 取込に成功した車両マスタ1行 (vehicle_master テーブルへの upsert 単位)。 */
export interface VehicleMasterImportRow {
  vehicleNo: string;
  vehicleType: string;
  depot: string;
  /** STANDARD_COST_RATES のキー (6.5t/large/semiTrailer/unic/medium) */
  costCategory: string;
  /**
   * けん引するトラクタの車番 (「被けん引車」の行だけ)。CSVに「けん引車番」列が無い、
   * または空のときは undefined にして、画面で登録済みの対応を上書きしない。
   */
  towedByVehicleNo?: string | null;
  insCompulsory: number;
  insVoluntary: number;
  taxAuto: number;
  taxWeight: number;
  lease: number;
  installment: number;
}

/** 取込できなかった行。理由を添えてプレビュー画面に一覧表示し、CSV側を直してもらう。 */
export interface VehicleMasterImportRowError {
  /** ヘッダー行を1行目として数えたCSV上の行番号 (画面で該当行を探せるように) */
  rowNumber: number;
  vehicleNo: string;
  reason: string;
}

/**
 * 車種名 → 原価カテゴリ (STANDARD_COST_RATES のキー) の変換ルール。
 *
 * 元データの「車種名」は入力者の手打ちで表記が揺れる (「大型セミトレーラ」「セミトレ」等)ため、
 * 完全一致ではなく部分一致のパターン表で判定する。上から順に評価するので、より限定的な
 * 分類 (セミトレーラ・ユニック) を先に置く。「大型セミトレーラ」を large ではなく
 * semiTrailer に寄せるための順序であり、並べ替えると判定結果が変わる。
 *
 * 実データの車種名の網羅は運用しながら追加していく前提のため、判定できない車種名は
 * medium へ黙って倒さずエラー行として弾く (原価単価が倍近く違い、収支が静かに狂うため)。
 */
export const COST_CATEGORY_RULES: readonly { costCategory: string; pattern: RegExp }[] = [
  // 「被けん引車」はトレーラ本体。自走しないので走行距離が付かず、けん引するトラクタの
  // 行に合算される。semiTrailer(トラクタ側)より先に置かないと「トレーラ」で拾われてしまう。
  // 判定そのものは domain の isTrailerVehicleType と同じ規則を使う (二重定義にしない)。
  { costCategory: "trailer", pattern: TRAILER_VEHICLE_TYPE_PATTERN },
  { costCategory: "semiTrailer", pattern: /セミトレ|トレーラ|トレラ|牽引|トラクタ/ },
  // 実データの車種名は「3ｔU」のように、ユニックを積載量+末尾1文字で表す
  // (「10ｔW」= ウイング、「3ｔ平」= 平ボディ と同じ書き方)。この表記を拾えないと
  // ユニック7台が medium に倒れ、修繕費・タイヤ費の標準単価が実態より安く付く。
  // 誤爆を避けるため、数字+t の直後に単独で u が来る形だけを認める
  // (末尾の (?![a-z]) が無いと "4tunit" のような未知の表記まで拾ってしまう)。
  { costCategory: "unic", pattern: /ユニック|ﾕﾆｯｸ|クレーン|ｸﾚｰﾝ|\d(?:\.\d+)?tu(?![a-z])/ },
  { costCategory: "6.5t", pattern: /6\.5/ },
  { costCategory: "large", pattern: /大型|増トン|1[0-5]t|1[0-5]トン|[78]t|[78]トン/ },
  { costCategory: "medium", pattern: /中型|小型|準中型|[1-4]t|[1-4]トン|バン|平ボディ/ },
];

/**
 * 表記ゆれの吸収。全角英数字・全角ピリオドを半角へ寄せ、空白を除き、
 * 大文字小文字を無視する ("６．５ｔ ウイング" → "6.5t ウイング" → "6.5tウイング")。
 */
function normalizeVehicleType(value: string): string {
  return value
    .replace(/[Ａ-Ｚａ-ｚ０-９．]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]/g, "")
    .toLowerCase();
}

/** 車種名から原価カテゴリを導く。どのルールにも当てはまらなければ null (呼び出し側でエラー行にする)。 */
export function mapVehicleTypeToCostCategory(vehicleType: string): string | null {
  const normalized = normalizeVehicleType(vehicleType);
  if (normalized === "") return null;
  return COST_CATEGORY_RULES.find((rule) => rule.pattern.test(normalized))?.costCategory ?? null;
}

/**
 * CSVとExcelの共通の中間表現。取込元が何であれ、金額を数値に直しただけの生の行を
 * ここに揃えてから同じ検証(車種名→原価カテゴリの判定)にかける。
 * 判定規則を経路ごとに書くと、CSVでは通る車両がExcelでは弾かれる等のズレが出るため。
 */
interface VehicleMasterSourceRow {
  /** 画面で該当行を探すための、取込元ファイル上の行番号 */
  rowNumber: number;
  vehicleNo: string;
  vehicleType: string;
  depot: string;
  towedByVehicleNo?: string | null;
  insCompulsory: number;
  insVoluntary: number;
  taxAuto: number;
  taxWeight: number;
  lease: number;
  installment: number;
}

export interface VehicleMasterParseResult {
  valid: VehicleMasterImportRow[];
  errors: VehicleMasterImportRowError[];
  /** 元データのどこを読んだか (画面に出して人が確かめられるようにする) */
  source?: ImportSourceInfo;
}

/**
 * 中間表現の行を、原価カテゴリを付けた取込行と、判定できなかったエラー行に振り分ける。
 *
 * 例外ではなく { valid, errors } を返すのは、1行の車種名が判定できないだけで
 * ファイル全体の取込を止めると、実務では毎回全部やり直しになるため。画面側で
 * エラー行を見せたうえで、正常行だけを確定できるようにする。
 */
function classifySourceRows(sources: readonly VehicleMasterSourceRow[]): VehicleMasterParseResult {
  const valid: VehicleMasterImportRow[] = [];
  const errors: VehicleMasterImportRowError[] = [];

  for (const source of sources) {
    if (source.vehicleNo === "") continue; // 合計行・空行はエラーにせず読み飛ばす

    // 完成済みの収支表(運送収支表ブック)は、けん引の組を1行にまとめて車番を
    // 「129 1113」と書く。マスタは1台1行なので、そのまま登録すると "1291113" という
    // 実在しない車両ができ、以後どの実績とも結合できない行が静かに残る。
    const parts = splitCompositeVehicleNo(source.vehicleNo);
    if (parts.length > 1) {
      errors.push({
        rowNumber: source.rowNumber,
        vehicleNo: source.vehicleNo,
        reason: `車番が「${parts.join(" / ")}」と2台分まとめて書かれています。車両マスタは1台ずつ登録するため、けん引の組をまとめる前のExcel「★車両別収支計算用」を選ぶか、この行を1台ずつに分けてください`,
      });
      continue;
    }

    const costCategory = mapVehicleTypeToCostCategory(source.vehicleType);
    if (!costCategory) {
      errors.push({
        rowNumber: source.rowNumber,
        vehicleNo: source.vehicleNo,
        reason: `車種名「${source.vehicleType}」から原価カテゴリ(6.5t/large/semiTrailer/unic/medium)を判定できませんでした`,
      });
      continue;
    }

    const { rowNumber: _rowNumber, ...rest } = source;
    valid.push({ ...rest, costCategory });
  }

  return { valid, errors };
}

/** xlsx (ZIP) の先頭4バイト。拡張子でもMIMEでもなく中身で判定する。 */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function isXlsx(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * 車両マスタの取込口。Excel (.xlsx) とCSVのどちらを渡されても受け付ける。
 *
 * 拡張子やMIMEタイプではなく中身の先頭バイトで振り分ける。ブラウザの accept 属性は
 * 選択ダイアログの初期フィルタでしかなく、「すべてのファイル」を選べばxlsxがそのまま
 * 飛んでくる。実際、xlsxをCSVとしてcp932デコードした結果「実際の見出し: PK…[Content_Types].xml」
 * という読めないエラーが利用者に出ていた。
 */
export function parseVehicleMasterFile(
  input: ArrayBuffer | Uint8Array,
  preferredYearMonth?: string,
): VehicleMasterParseResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return isXlsx(bytes)
    ? parseVehicleMasterWorkbook(bytes, preferredYearMonth)
    : parseVehicleMasterCsv(bytes);
}

/**
 * 社内Excel「★車両別収支計算用」の収支表シートから、車両マスタを直接取り込む。
 *
 * CSVに書き出す手作業を挟まないぶん、書き出し漏れ・列並べ替え・文字コード事故が起きない。
 * シートの検出と51列の名前解決は月次収支表の取込 (parseMonthlyPlWorkbook) と同じ実装を使う。
 * 実績値(運賃・燃料費等)は無視し、マスタとして意味を持つ保険・税・リース料だけを拾う。
 */
export function parseVehicleMasterWorkbook(
  input: ArrayBuffer | Uint8Array,
  preferredYearMonth?: string,
): VehicleMasterParseResult {
  // 保険・税・リース料は「その月の実績」ではなく車両ごとの決まった金額なので、対象年月の
  // シートが無くてもいちばん新しい月で代用してよい ("useLatest")。ここを月次収支表の取込と
  // 同じ厳格さ("throw")にしていたため、8月に既定の対象月(6月)で5月までのブックを選ぶと
  // 必ず失敗し、画面には0台のまま何も登録されない、という行き止まりになっていた。
  const { rows, sheetName, sheetYearMonth } = parseMonthlyPlWorkbook(
    input,
    preferredYearMonth,
    "useLatest",
  );

  const sources: VehicleMasterSourceRow[] = rows.map((row, index) => ({
    rowNumber: index + 2, // 見出し行を1行目として数える (CSV経路と合わせる)
    vehicleNo: normalizeKey(row.no),
    vehicleType: row.type.trim(),
    depot: row.depot.trim(),
    insCompulsory: row.insCompulsory,
    insVoluntary: row.insVoluntary,
    taxAuto: row.taxAuto,
    taxWeight: row.taxWeight,
    lease: row.lease,
    installment: row.installment,
  }));

  const result = classifySourceRows(sources);
  applyTowedByFromRowOrder(result.valid);
  return {
    ...result,
    source: {
      kind: "excel",
      sheetName,
      sheetYearMonth,
      ...(preferredYearMonth && sheetYearMonth !== preferredYearMonth
        ? { fallbackFromYearMonth: preferredYearMonth }
        : {}),
    },
  };
}

/**
 * 収支表シートの行の並び順から、被けん引車(トレーラ)のけん引先トラクタを推定して
 * towedByVehicleNo に書き込む (in-place)。
 *
 * 実データ(★車両別収支計算用2026年5月.xlsx)では、末尾に以下の並びで5組が入っている:
 *   129(セミトレ) / 1113(被けん引車) / 2(セミトレ) / 1100(被けん引車) / …
 * トラクタとトレーラの対応表はどのCSVにも列として存在せず、この並び順とExcelの行ラベル
 * 「129/1113」にしか無い (だから今までは画面で1組ずつ手で選ぶしかなかった)。
 *
 * 確信が持てない行には値を入れない。undefined のままにしておけば画面側で登録済みの
 * 対応を上書きしないが、誤ったトラクタを入れると収支表が黙って別の車両に合算される。
 * そこで、次の3つが揃った並びだけを「対応表」とみなす:
 *   1. 直前の行が semiTrailer である (自走しない被けん引車をけん引できるのはトラクタだけ)
 *   2. そのトラクタがまだ他のトレーラに割り当てられていない (実データの5組はすべて1対1)
 *   3. トレーラ側に既に対応が入っていない (CSVの「けん引車番」列など明示指定を優先する)
 * 例えばトレーラが2行続く並びでは、2台目は1と2のどちらにも当てはまらないので手選択に委ねる。
 */
function applyTowedByFromRowOrder(rows: VehicleMasterImportRow[]): void {
  const takenTractors = new Set<string>();

  rows.forEach((row, index) => {
    if (row.costCategory !== "trailer" || row.towedByVehicleNo !== undefined) return;

    const previous = rows[index - 1];
    if (!previous || previous.costCategory !== "semiTrailer") return;
    if (takenTractors.has(previous.vehicleNo)) return;

    takenTractors.add(previous.vehicleNo);
    row.towedByVehicleNo = previous.vehicleNo;
  });
}

/**
 * 車両マスタ CSV (社内Excel「★車両別収支計算用」収支表シートから書き出した車両一覧) パーサ。
 * 保険・税・リース料は毎月の収支計算の土台になるため、収支表側を直接いじらず
 * ここからマスタへ一括登録・更新できるようにする (業務フロー STEP7)。
 */
export function parseVehicleMasterCsv(
  input: string | ArrayBuffer | Uint8Array,
): VehicleMasterParseResult {
  const text = typeof input === "string" ? input : decodeCp932(input);
  const rows = parseCsv(text);
  assertRequiredHeaders(rows, REQUIRED_HEADERS, "車両マスタ");

  const sources = toRecords(rows).map((r, index) => ({
    rowNumber: index + 2, // ヘッダー行を1行目として数える
    // 車番は運行実績の車両番号と同じ正規化 (先頭ゼロ除去) をかける。
    // ここが揃っていないと収支確定時に車両マスタと運行実績が結合できない。
    vehicleNo: normalizeKey(r["車番"]),
    vehicleType: (r["車種名"] ?? "").trim(),
    depot: (r["所属"] ?? "").trim(),
    // 「けん引車番」は任意列。現行の書き出しには無いので、列が用意できたときだけ取り込む。
    towedByVehicleNo: normalizeKey(r["けん引車番"] ?? "") || undefined,
    insCompulsory: parseJapaneseAmount(r["自賠責保険"]),
    insVoluntary: parseJapaneseAmount(r["任意保険"]),
    taxAuto: parseJapaneseAmount(r["自動車税"]),
    taxWeight: parseJapaneseAmount(r["自動車重量税"]),
    lease: parseJapaneseAmount(r["車両リース費"]),
    installment: parseJapaneseAmount(r["車両割賦支払費"]),
  }));

  return { ...classifySourceRows(sources), source: { kind: "csv" } };
}
