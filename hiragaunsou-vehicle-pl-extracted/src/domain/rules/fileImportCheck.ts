import { describeYearMonth } from "../../infrastructure/parsers/detectYearMonth";
import { findImportSource } from "./importSources";

/**
 * ファイル取込の「中身の判定結果 → 画面に出す言葉」を一箇所に集めた純関数群。
 *
 * 仕様は docs/product/file-import-common-spec.md。文言を画面側で組み立てると、
 * 画面ごとに言い回しがずれて利用者が別の意味だと誤解する。判定も文章もここだけで作り、
 * 画面(月次データ取込・車両マスタ・運転者マスタ)はこの結果をそのまま表示する。
 *
 * 専門用語(ハッシュ・スキーマ・バリデーション)は絶対に外へ出さない。
 */

/** ファイルを選べる画面。取込の記録にもこの値を残す。 */
export type ImportScreen = "import" | "vehicle_master" | "driver_master";

export const IMPORT_SCREEN_LABELS: Record<ImportScreen, string> = {
  import: "月次データ取込",
  vehicle_master: "車両マスタ管理",
  driver_master: "運転者マスタ管理",
};

/** 前に取り込んだファイルとの照合結果。中身の同一性が主、ファイル名は参考。 */
export interface DuplicateFinding {
  /** 中身が同じで名前も同じ / 名前は同じで中身が違う / 名前は違うが中身が同じ */
  match: "sameContentSameName" | "sameNameChangedContent" | "sameContentOtherName";
  /** 前に取り込んだときのファイル名(参考情報。判定には使っていない) */
  fileName: string;
  /** 前に取り込んだ日時 (エポックミリ秒) */
  importedAt: number;
  /** 前に取り込んだ件数。分からなければ null */
  rowCount: number | null;
  /** 前に取り込んだときの対象年月 */
  yearMonth: string | null;
}

export interface FileImportCheckInput {
  screen: ImportScreen;
  /**
   * この投入口が受け付ける帳票の種類。空なら種類を問わない。
   * マスタ画面は社内Excelと手作りCSVの両方を受けるため複数になる
   * (CSVは列見出しが社内様式なので "unknown" と判定され、種類ではなく必須列で見る)。
   */
  acceptedSourceTypes: readonly string[];
  /** この投入口が受け付けるものの呼び名。「この欄は『〜』を取り込むところです」に使う */
  expectedLabel: string;
  /** 中身から判定された帳票の種類。判定できなければ "unknown" */
  detectedSourceType: string;
  /** 画面でいま選んでいる対象年月。月に紐づかない取込は null */
  expectedYearMonth: string | null;
  /** 中身から判定された対象年月。判定できなければ null */
  detectedYearMonth: string | null;
  /** 年月の判定根拠(そのまま画面に出す一文) */
  yearMonthBasis: string;
  /** 中身に複数の年月があったときの候補(新しい順) */
  yearMonthCandidates: string[];
  /** 必要なのに見つからなかった列見出し */
  missingColumns: string[];
  /** 今回のファイルの件数。分からなければ null */
  rowCount: number | null;
  duplicate: DuplicateFinding | null;
}

export interface FileImportIssue {
  kind:
    | "typeMismatch"
    | "typeUnknown"
    | "missingColumns"
    | "yearMonthMismatch"
    | "yearMonthUnknown"
    | "yearMonthMixed"
    | "duplicate";
  title: string;
  body: string;
  /** 正しい画面・欄への導線 */
  link: { label: string; href: string } | null;
}

export interface FileImportVerdict {
  /** 「売上モニタリスト / 2026年5月分と読み取りました」 */
  summary: string;
  /** 判定根拠の一文 */
  basis: string;
  /**
   * ok      … そのまま取り込んでよい
   * confirm … 利用者が確定操作をすれば取り込める(月違い・重複)
   * blocked … このファイルはこの画面では取り込めない(種類違い・列不足)
   */
  status: "ok" | "confirm" | "blocked";
  issues: FileImportIssue[];
  /** 確定ボタンの文言。blocked のときは null */
  confirmLabel: string | null;
  /** 対象年月を選び直させる必要があるか */
  needsYearMonthChoice: boolean;
  /** 年月選択の初期値(自動判定できた月。決まらなければ画面の年月) */
  suggestedYearMonth: string | null;
}

/** 帳票の種類 → その帳票を取り込む場所。種類違いのときの導線に使う。 */
const SOURCE_LOCATIONS: Record<string, { label: string; href: string }> = {
  vehicle_operation: { label: "月次データ取込のSTEP1 車両別運行実績表", href: "/import" },
  sales_monitor: { label: "月次データ取込のSTEP2 売上モニタリスト", href: "/import" },
  payroll: { label: "月次データ取込のSTEP4 給与集計表(日給者)", href: "/import" },
  monthly_pl_workbook: { label: "月次データ取込の答え合わせの欄", href: "/import" },
};

/** 画面が受け付けるものの呼び名(利用者の言葉)。 */
const SCREEN_EXPECTATIONS: Record<ImportScreen, string> = {
  import: "月次の帳票",
  vehicle_master: "★車両別収支計算用 の収支表シート(車両の一覧)",
  driver_master: "★車両別収支計算用 の収支表シート(車番と運転者の対応)",
};

/**
 * 投入口ごとの「受け付ける帳票の種類」。
 *
 * マスタ画面は社内Excel(収支表シート)に加えて、社内様式のCSVも受け付ける。
 * このCSVは月次3帳票のどれとも列見出しが違うため "unknown" と判定されるので、
 * 種類では弾かず必須列(requiredHeaders)の側で見る。ここで "unknown" を外すと、
 * 今まで取り込めていたマスタCSVが取り込めなくなる。
 */
export function acceptedSourceTypesFor(
  screen: ImportScreen,
  expectedSourceType: string | null,
): string[] {
  if (screen === "import") return expectedSourceType ? [expectedSourceType] : [];
  return ["monthly_pl_workbook", "unknown"];
}

/** 投入口の呼び名。月次は帳票名、マスタは画面が受け付けるものの呼び名。 */
export function expectedLabelFor(screen: ImportScreen, expectedSourceType: string | null): string {
  if (screen === "import") return expectedSourceType ? describeSourceType(expectedSourceType) : "月次の帳票";
  return SCREEN_EXPECTATIONS[screen];
}

export function describeSourceType(sourceType: string): string {
  return findImportSource(sourceType)?.label ?? "この帳票";
}

/** エポックミリ秒 → 「8月5日」。年が違えば「2025年8月5日」。 */
export function describeImportedAt(importedAt: number, now: number = Date.now()): string {
  const date = new Date(importedAt);
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === new Date(now).getFullYear() ? md : `${date.getFullYear()}年${md}`;
}

/**
 * 判定結果を画面の言葉に翻訳する。ここが全画面共通の「止める/通す」の唯一の判断。
 *
 * 優先順は 種類 → 列 → 重複 → 年月。種類が違えば列不足はその症状にすぎず、
 * 両方並べても利用者は次に何をすればいいか分からなくなる。
 */
export function evaluateFileImport(input: FileImportCheckInput): FileImportVerdict {
  const issues: FileImportIssue[] = [];
  const summary = buildSummary(input);
  let status: FileImportVerdict["status"] = "ok";
  let confirmLabel: string | null = null;
  let needsYearMonthChoice = false;

  const typeIssue = checkType(input);
  if (typeIssue) {
    return {
      summary,
      basis: input.yearMonthBasis,
      status: "blocked",
      issues: [typeIssue],
      confirmLabel: null,
      needsYearMonthChoice: false,
      suggestedYearMonth: input.detectedYearMonth ?? input.expectedYearMonth,
    };
  }

  if (input.missingColumns.length > 0) {
    return {
      summary,
      basis: input.yearMonthBasis,
      status: "blocked",
      issues: [
        {
          kind: "missingColumns",
          title: "必要な列が見つかりませんでした",
          body: `${input.missingColumns.map((c) => `「${c}」`).join("")}の列が見つかりませんでした。ファイルの見出し行をご確認ください。`,
          link: null,
        },
      ],
      confirmLabel: null,
      needsYearMonthChoice: false,
      suggestedYearMonth: input.detectedYearMonth ?? input.expectedYearMonth,
    };
  }

  const duplicateIssue = input.duplicate ? describeDuplicate(input.duplicate, input) : null;
  if (duplicateIssue) {
    issues.push(duplicateIssue.issue);
    status = "confirm";
    confirmLabel = duplicateIssue.confirmLabel;
  }

  const yearMonthIssue = checkYearMonth(input);
  if (yearMonthIssue) {
    issues.push(yearMonthIssue.issue);
    status = "confirm";
    needsYearMonthChoice = true;
    // 年月の確定の方が具体的なので、ボタンの文言は年月側を優先する。
    confirmLabel = yearMonthIssue.confirmLabel;
  }

  return {
    summary,
    basis: input.yearMonthBasis,
    status,
    issues,
    confirmLabel: status === "confirm" ? (confirmLabel ?? "この内容で取り込む") : null,
    needsYearMonthChoice,
    suggestedYearMonth: input.detectedYearMonth ?? input.expectedYearMonth,
  };
}

function buildSummary(input: FileImportCheckInput): string {
  const type =
    input.detectedSourceType === "unknown"
      ? "何の帳票か判定できませんでした"
      : `「${describeSourceType(input.detectedSourceType)}」`;
  const period = input.detectedYearMonth ? `${describeYearMonth(input.detectedYearMonth)}分` : "対象年月は判定できませんでした";
  const count = input.rowCount === null ? "" : `・${input.rowCount}件`;
  return `${type} / ${period}${count}`;
}

function checkType(input: FileImportCheckInput): FileImportIssue | null {
  if (input.acceptedSourceTypes.length === 0) return null;
  if (input.acceptedSourceTypes.includes(input.detectedSourceType)) return null;

  const expected = input.expectedLabel;
  if (input.detectedSourceType === "unknown") {
    return {
      kind: "typeUnknown",
      title: "このファイルが何の帳票か分かりませんでした",
      body: `この欄は「${expected}」を取り込むところです。見出し行がある元のファイルをそのまま選んでください(ファイル名は変わっていても構いません)。`,
      link: null,
    };
  }

  const detected = describeSourceType(input.detectedSourceType);
  const location = SOURCE_LOCATIONS[input.detectedSourceType];
  return {
    kind: "typeMismatch",
    title: `このファイルは「${detected}」のようです`,
    body: location
      ? `この欄は「${expected}」を取り込むところです。${detected}は${location.label}から取り込んでください。`
      : `この欄は「${expected}」を取り込むところです。`,
    link: location ? { label: `${location.label}へ移動`, href: location.href } : null,
  };
}

function checkYearMonth(
  input: FileImportCheckInput,
): { issue: FileImportIssue; confirmLabel: string } | null {
  if (input.expectedYearMonth === null) return null;

  if (input.detectedYearMonth === null) {
    return {
      issue: {
        kind: "yearMonthUnknown",
        title: "この取込は何年何月分ですか?",
        body: `${input.yearMonthBasis}いま作成中なのは${describeYearMonth(input.expectedYearMonth)}分です。取り込む年月を選んでください。`,
        link: null,
      },
      confirmLabel: `${describeYearMonth(input.expectedYearMonth)}分として取り込む`,
    };
  }

  if (input.yearMonthCandidates.length > 1) {
    return {
      issue: {
        kind: "yearMonthMixed",
        title: "この取込は何年何月分ですか?",
        body: `このファイルには ${input.yearMonthCandidates.map(describeYearMonth).join(" / ")} が入っています。いちばん多い${describeYearMonth(input.detectedYearMonth)}分を初期値にしました。違っていれば選び直してください。`,
        link: null,
      },
      confirmLabel: `${describeYearMonth(input.detectedYearMonth)}分として取り込む`,
    };
  }

  if (input.detectedYearMonth !== input.expectedYearMonth) {
    return {
      issue: {
        kind: "yearMonthMismatch",
        title: "この取込は何年何月分ですか?",
        body: `選ばれたファイルは${describeYearMonth(input.detectedYearMonth)}分ですが、いま作成中なのは${describeYearMonth(input.expectedYearMonth)}分です。どちらの月として取り込むか選んでください。`,
        link: null,
      },
      confirmLabel: `${describeYearMonth(input.detectedYearMonth)}分として取り込む`,
    };
  }

  return null;
}

function describeDuplicate(
  duplicate: DuplicateFinding,
  input: FileImportCheckInput,
): { issue: FileImportIssue; confirmLabel: string } {
  const when = describeImportedAt(duplicate.importedAt);
  if (duplicate.match === "sameContentSameName") {
    return {
      issue: {
        kind: "duplicate",
        title: `このファイルは ${when} に取り込み済みです(中身も同じです)`,
        body: "もう一度取り込む必要はありません。同じ内容をもう一度入れ直したいときだけ続けてください。",
        link: null,
      },
      confirmLabel: "それでも取り込む",
    };
  }
  if (duplicate.match === "sameContentOtherName") {
    return {
      issue: {
        kind: "duplicate",
        title: `別の名前ですが、${when} に取り込んだファイルと中身が同じです`,
        body: `そのときのファイル名は「${duplicate.fileName}」でした。同じ内容をもう一度入れ直したいときだけ続けてください。`,
        link: null,
      },
      confirmLabel: "それでも取り込む",
    };
  }
  return {
    issue: {
      kind: "duplicate",
      title: `同じ名前のファイルを ${when} に取り込んでいますが、中身が変わっています`,
      body: `更新版と思われます。${describeChange(duplicate, input)}新しい内容で置き換えてよければ続けてください。`,
      link: null,
    },
    confirmLabel: "新しい内容で置き換える",
  };
}

/** 「何が変わったか」を件数と対象年月で要約する。黙って上書きさせないための材料。 */
function describeChange(duplicate: DuplicateFinding, input: FileImportCheckInput): string {
  const parts: string[] = [];
  if (duplicate.rowCount !== null && input.rowCount !== null && duplicate.rowCount !== input.rowCount) {
    const diff = input.rowCount - duplicate.rowCount;
    const direction = diff > 0 ? `${diff}件増えています` : `${-diff}件減っています`;
    parts.push(`前回は${duplicate.rowCount}件、今回は${input.rowCount}件で${direction}`);
  }
  if (duplicate.yearMonth && input.detectedYearMonth && duplicate.yearMonth !== input.detectedYearMonth) {
    parts.push(
      `前回は${describeYearMonth(duplicate.yearMonth)}分、今回は${describeYearMonth(input.detectedYearMonth)}分です`,
    );
  }
  if (parts.length === 0) {
    parts.push("件数と対象年月は前回と同じですが、中身のどこかが書き換わっています");
  }
  return `${parts.join("。")}。`;
}

/** 画面が「何を受け付けるところか」の説明文。各画面の案内文をここで統一する。 */
export function describeScreenExpectation(screen: ImportScreen): string {
  return `${SCREEN_EXPECTATIONS[screen]}を取り込みます。ファイル名は変わっても構いません。中身で判定します。`;
}
