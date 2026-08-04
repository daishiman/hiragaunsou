/**
 * 取込対象の帳票一覧。『車両別収支表 作成業務フロー』のSTEPと1対1で対応させる。
 *
 * 画面(投入口)とAPI(入れ直し判定)の両方がこの定義を参照する。
 * 帳票ごとに「月に何ファイル来るか」が違い、それが入れ直しの範囲を決める:
 *   - 車両別運行実績表は3営業所分が別ファイルで届くため、同名ファイルだけを入れ直す
 *   - それ以外は月1ファイルなので、その月の取込全体を入れ直す
 * ここを取り違えると、津山営業所を取り込んだ瞬間に本社分が消える。
 */
export interface ImportSourceDefinition {
  sourceType: "vehicle_operation" | "sales_monitor" | "payroll" | "monthly_pl_workbook";
  /** 業務フロー上のSTEP表記 */
  step: string;
  label: string;
  /** 出力元システム */
  system: string;
  hint: string;
  accept: string;
  /** 月内に複数ファイルが正常に存在しうるか */
  multiFile: boolean;
}

export const IMPORT_SOURCES: readonly ImportSourceDefinition[] = [
  {
    sourceType: "vehicle_operation",
    step: "STEP1",
    label: "車両別運行実績表",
    system: "ITP-WEBServiceV3(デジタコ)",
    hint: "営業所ごとに1ファイル(3営業所分)",
    accept: ".csv",
    multiFile: true,
  },
  {
    sourceType: "sales_monitor",
    step: "STEP2",
    label: "売上モニタリスト",
    system: "車楽クラウド",
    hint: "月1ファイル・車番別集計は自動",
    accept: ".csv",
    multiFile: false,
  },
  {
    sourceType: "payroll",
    step: "STEP4",
    label: "給与集計表(日給者)",
    system: "ACELINK NX-CE",
    hint: "月1ファイル",
    accept: ".csv",
    multiFile: false,
  },
  {
    sourceType: "monthly_pl_workbook",
    step: "STEP7-8",
    label: "完成済み 車両別収支表(Excel)",
    system: "★運送収支表 年度ブック",
    hint: "年度ブック・Excelで再計算して保存済みのもの",
    accept: ".xlsx",
    multiFile: false,
  },
] as const;

export type ImportSourceType = ImportSourceDefinition["sourceType"];

export function findImportSource(sourceType: string): ImportSourceDefinition | undefined {
  return IMPORT_SOURCES.find((source) => source.sourceType === sourceType);
}
